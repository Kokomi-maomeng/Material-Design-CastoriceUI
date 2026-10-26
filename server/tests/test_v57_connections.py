"""Populated connection regressions through collectors, SQLite and real HTTP."""
from datetime import datetime, timezone
import http.client
import json
import threading
from unittest.mock import patch

from test_v51_regressions import IsolatedState
from castoriceui.api import ApiServer
from castoriceui.collectors import connection_snapshots


class Connections(IsolatedState):
    def setUp(self):
        super().setUp()
        self.now = datetime.now(timezone.utc).isoformat()
        self.dashboard.system_cache = {'observedAt': self.now, 'kernel': 'Synthetic Linux', 'memoryTotalBytes': 1024**3,
            'databaseWritable': True, 'databaseBytes': 4096, 'trafficUsedBytes': 0, 'trafficLimitBytes': 10**12,
            'cpuCores': 1, 'load': [0, 0, 0], 'uptimeSeconds': 60, 'nodeName': 'Synthetic', 'diskPercent': 50}
        self.dashboard.runtime_cache.update(observedAt=self.now, hy2={'available': True}, singbox={'available': True})
        for name in ('system', 'runtime', 'hysteria2', 'singbox', 'network', 'subscriptions'):
            self.dashboard._collection_result(name, observed_at=self.now)

    def raw(self, identity='qa', source='192.0.2.1', id='flow'):
        return {'id': id, 'protocol': 'AnyTLS', 'account': identity, 'sourceIp': source, 'ipVersion': 4,
                'uploadedBytes': 100, 'downloadedBytes': 200, 'connectedAt': self.now, 'destination': 'private-destination.example.test:443'}

    def test_group_identity_survives_reorder_disconnection_and_process_restart(self):
        a,b=self.raw(),self.raw('qb','192.0.2.2','other')
        first=self.dashboard.aggregate_connections([a,b])
        ids={g['account']:g['id'] for g in first}
        second=self.dashboard.aggregate_connections([b,a])
        self.assertEqual({g['account']:g['id'] for g in second},ids)
        self.assertEqual(self.dashboard.aggregate_connections([b])[0]['id'],ids['qb'])
        self.dashboard.connection_baseline={}
        again=self.dashboard.aggregate_connections([b])[0]
        self.assertEqual(again['id'],ids['qb']);self.assertIsNone(again['downloadBps'])

    def test_online_clients_include_idle_clients_and_are_not_assigned_to_multiple_sources(self):
        groups=self.dashboard.with_online_clients([],{'available': True,'online': {'idle': 3,'none': 0,'bad': True}})
        self.assertEqual(len(groups),1)
        self.assertEqual((groups[0]['onlineClients'],groups[0]['connections'],groups[0]['details']),(3,0,[]))
        self.assertIsNone(groups[0]['downloadBps'])
        a,b=self.raw(source='192.0.2.1'),self.raw(source='192.0.2.2',id='b')
        for row in (a,b):row['protocol']='Hysteria2'
        groups=self.dashboard.aggregate_connections([a,b])
        result=self.dashboard.with_online_clients(groups,{'available': True,'online': {'qa': 4}})
        self.assertTrue(all('onlineClients' not in g for g in result))
        self.assertEqual(self.dashboard.with_online_clients([],{'available': False,'online': {'idle': 3}}),[])
        partial=self.dashboard.with_online_clients([],{'available':False,'endpointStatus':{'online':True,'streams':False},'online':{'idle':3}})
        self.assertFalse(partial[0]['entriesAvailable'],'failed stream API must not look like zero TCP activity')

    def test_ipv6_destinations_and_all_supported_singbox_protocol_mappings(self):
        types={'anytls':'anytls','vless':'vless','socks5':'mixed','shadowsocks':'shadowsocks','vmess':'vmess','trojan':'trojan','tuic':'tuic'}
        connections=[{'id': name,'metadata': {'type': kind+'/'+name,'network': 'tcp','sourceIP': '2001:db8::1','destinationIP': '2001:db8::2','destinationPort': '443'},'upload': 5,'download': 8} for name,kind in types.items()]
        sb={'connections': connections, 'inventory': {'available': True,'inbounds': [{'tag': name,'type': kind} for name,kind in types.items()]}}
        adapters={name:{'inboundTags':[name]} for name in types}
        rows=connection_snapshots({},sb,adapters)
        self.assertEqual(len(rows),7)
        self.assertTrue(all(row['destination']=='[2001:db8::2]:443' and row['sourceIp']=='2001:db8::1' and row['account']=='' for row in rows))
        for profile,label in [('standard','VLESS'),('xtls-vision','VLESS · XTLS Vision'),('reality','VLESS · Reality'),('xtls-vision-reality','VLESS · XTLS Vision · Reality')]:
            adapters['vless']['securityProfile']=profile
            self.assertEqual(next(r for r in connection_snapshots({},sb,adapters) if r['id']=='vless')['protocol'],label)

    def test_live_target_endpoint_requires_authentication_is_no_store_and_does_not_persist(self):
        self.dashboard.runtime_cache['connections']=self.dashboard.aggregate_connections([self.raw()])
        user=self.storage.create_initial_user('qa-targets','Synthetic-Password-123!')
        token,_,_=self.storage.create_session(user,3600)
        server=ApiServer(self.config,self.storage,self.dashboard)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(path,authenticated=True):
            client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            try:
                client.request('GET',path,headers={'Cookie':'castorice_session='+token} if authenticated else {})
                response=client.getresponse();return response.status,dict(response.getheaders()),json.loads(response.read())
            finally:client.close()
        try:
            self.assertEqual(request('/api/v2/connections/targets',False)[0],401)
            for redact in (True,False):
                self.config.redact_live_data=redact
                status,headers,normal=request('/api/v2/dashboard')
                self.assertEqual(status,200)
                self.assertIsNone(normal['connections'][0]['details'][0]['destination'])
                status,headers,live=request('/api/v2/connections/targets')
                self.assertEqual(status,200);self.assertIn('no-store',headers['Cache-Control'])
                self.assertEqual(live['groups'][0]['details'][0]['destination'],self.raw()['destination'])
            with self.storage.connect() as db:
                self.assertNotIn(self.raw()['destination'],'\n'.join(db.iterdump()))
            self.storage.delete_session(token)
            self.assertEqual(request('/api/v2/connections/targets')[0],401)
        finally:server.shutdown();server.server_close();thread.join(3)

    def test_stale_failed_or_restarted_sources_have_no_live_targets_or_rates(self):
        row=self.raw()
        with patch('castoriceui.dashboard.time.monotonic',return_value=10):self.dashboard.aggregate_connections([row])
        with patch('castoriceui.dashboard.time.monotonic',return_value=15):
            self.dashboard.runtime_cache['connections']=self.dashboard.aggregate_connections([{**row,'downloadedBytes':700}])
        self.assertTrue(self.dashboard.connection_targets()['available'])
        for state in ('stale','error','unavailable'):
            self.dashboard._collection_result('singbox', observed_at='2000-01-01T00:00:00Z' if state=='stale' else self.now,error='unavailable' if state!='stale' else None)
            self.assertFalse(self.dashboard.connection_targets()['available'])
            payload=self.dashboard.snapshot()
            self.assertIsNone(payload['connections'][0]['downloadBps'])
            self.assertIsNone(payload['connections'][0]['details'][0]['downloadBps'])
        self.assertIsNotNone(self.dashboard.runtime_cache['connections'][0]['downloadBps'],'projection must not mutate cached samples')
