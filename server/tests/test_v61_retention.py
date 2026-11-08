from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.storage import Storage, AUDIT_RETENTION_DAYS


class AuditRetentionTests(unittest.TestCase):
    def test_search_matches_localized_labels_and_literal_input_in_saved_records(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / 'state.db'))
            storage.add_audit('登录成功', '认证', '管理员会话已创建', actor='测试员')
            storage.add_audit('更新网络探测目标', '配置', '已保存 3 个探测目标')
            storage.add_audit('修改密码', '认证', '管理员密码已更新，其他会话已失效')
            for query, action in (
                ('登录成功', '登录成功'), ('ＳＩＧＮＥＤ ＩＮ', '登录成功'),
                ('session was created', '登录成功'), ('测试员', '登录成功'),
                ('3 probe targets', '更新网络探测目标'), ('changed password', '修改密码'),
            ):
                with self.subTest(query=query):
                    self.assertEqual([row['action'] for row in storage.audit_page(search=query)['items']], [action])
            self.assertEqual(storage.audit_page(search='%')['total'], 0)
            self.assertEqual(storage.audit_page(search='signed in', category='配置')['total'], 0)

    def test_every_retention_prunes_expired_rows_but_keeps_boundary_and_newer(self):
        now = 2_000_000_000
        for days in AUDIT_RETENTION_DAYS:
            with self.subTest(days=days), tempfile.TemporaryDirectory() as directory, patch('castoriceui.storage.time.time', return_value=now):
                storage = Storage(str(Path(directory) / 'state.db'))
                storage.set_setting('ui_settings', {'auditRetentionDays': days})
                cutoff = now - days * 86400
                with storage.connect() as connection:
                    for index, at in enumerate((cutoff - 1, cutoff, cutoff + 1)):
                        date = datetime.fromtimestamp(at, timezone.utc).isoformat(timespec='seconds')
                        connection.execute("INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES(?,?,?,?,?,?,?)", (str(index), '系统', 'system', '127.0.0.1', '成功', 'Synthetic', date))
                self.assertEqual(storage.prune_audits(), 1)
                self.assertEqual(storage.prune_audits(), 0)
                self.assertEqual([row['action'] for row in storage.audit_page()['items']], ['2', '1'])

    def test_shortening_policy_cleans_on_write_and_persists_after_restart(self):
        now = 2_000_000_000
        with tempfile.TemporaryDirectory() as directory, patch('castoriceui.storage.time.time', return_value=now):
            path = str(Path(directory) / 'state.db')
            storage = Storage(path)
            self.assertEqual(storage.audit_retention(), 180)
            with storage.connect() as connection:
                for age in (29, 31, 179, 181):
                    date = datetime.fromtimestamp(now - age * 86400, timezone.utc).isoformat()
                    connection.execute("INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES(?,?,?,?,?,?,?)", (str(age), '系统', 'system', '127.0.0.1', '成功', 'Synthetic', date))
            storage.set_setting('ui_settings', {'auditRetentionDays': 30, 'panelTitle': 'QA', 'idleTimeoutMinutes': 10})
            with patch('castoriceui.storage.utc_now', return_value=datetime.fromtimestamp(now, timezone.utc).isoformat()):
                storage.add_audit('updated', '配置', 'Synthetic change')
            self.assertEqual(storage.audit_page()['total'], 2)
            restarted = Storage(path)
            self.assertEqual(restarted.audit_retention(), 30)
            self.assertEqual(restarted.audit_page()['total'], 2)
            self.assertEqual(restarted.get_setting('ui_settings', {})['panelTitle'], 'QA')

    def test_startup_migrates_only_retired_panel_preference_and_cleans_without_new_events(self):
        now = 2_000_000_000
        with tempfile.TemporaryDirectory() as directory, patch('castoriceui.storage.time.time', return_value=now):
            path = str(Path(directory) / 'state.db')
            storage = Storage(path)
            settings = {'visiblePanels': ['alerts', 'subscriptions', 'accounts', 'connections'], 'panelTitle': 'QA', 'idleTimeoutMinutes': 20, 'auditRetentionDays': 60}
            storage.set_setting('ui_settings', settings)
            with storage.connect() as connection:
                connection.execute("INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES('old','系统','system','127.0.0.1','成功','Synthetic',?)", (datetime.fromtimestamp(now - 61 * 86400, timezone.utc).isoformat(),))
            restarted = Storage(path)
            self.assertEqual(restarted.audit_page()['total'], 0)
            self.assertEqual(restarted.get_setting('ui_settings', {}), {**settings, 'visiblePanels': ['alerts', 'accounts']})
            self.assertEqual(Storage(path).get_setting('ui_settings', {}), restarted.get_setting('ui_settings', {}))

    def test_invalid_stored_retention_falls_back_to_safe_default(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / 'state.db'))
            for value in (True, '30', -1, 0, 9999):
                storage.set_setting('ui_settings', {'auditRetentionDays': value})
                self.assertEqual(storage.audit_retention(), 180)

    def test_timezone_variants_expire_by_instant(self):
        now = 2_000_000_000
        with tempfile.TemporaryDirectory() as directory, patch('castoriceui.storage.time.time', return_value=now):
            storage = Storage(str(Path(directory) / 'state.db'))
            date = datetime.fromtimestamp(now - 181 * 86400, timezone.utc).isoformat().replace('+00:00', 'Z')
            with storage.connect() as connection:
                connection.execute("INSERT INTO audits(action,category,actor,source_ip,result,detail,created_at) VALUES('old','系统','system','127.0.0.1','成功','Synthetic',?)", (date,))
            self.assertEqual(storage.audit_page()['total'], 0)


if __name__ == '__main__':
    unittest.main()
