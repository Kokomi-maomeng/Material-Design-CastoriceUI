"""Audit translations for new and already stored records."""
import re
import unicodedata

ACTIONS_EN = {
    "更新流量额度": "Updated traffic quota",
    "更新面板设置": "Updated panel settings",
    "更新登录背景": "Updated sign-in background",
    "创建初始管理员": "Created initial administrator",
    "登录失败": "Sign-in failed",
    "登录成功": "Signed in",
    "退出登录": "Signed out",
    "修改密码": "Changed password",
    "修改密码失败": "Password change failed",
    "完成初始化向导": "Completed initialization",
    "确认告警": "Acknowledged alert",
    "确认全部告警": "Acknowledged all alerts",
    "清理旧版接入密钥": "Removed legacy integration secret",
    "更新数据接入": "Updated data integration",
    "更新网络探测目标": "Updated network probe targets",
}

DETAILS_EN = {
    "总流量额度已更新": "The total traffic quota was updated",
    "导航可见性设置已更新": "Navigation visibility settings were updated",
    "界面偏好设置已更新": "Interface preferences were updated",
    "首次安全初始化已完成": "Secure first-run administrator creation completed",
    "用户名或密码错误": "The username or password was incorrect",
    "管理员会话已创建": "An administrator session was created",
    "管理员会话已注销": "The administrator session was invalidated",
    "旧密码验证失败": "The current password was incorrect",
    "管理员密码已更新，其他会话已失效": "The administrator password was changed and other sessions were invalidated",
    "必要的面板设置已确认": "Required panel settings were confirmed",
    "已从 SQLite 覆盖项中移除 v1.2 遗留的明文 Secret": "A legacy v1.2 plaintext secret was removed from SQLite overrides",
}

DETAIL_PATTERNS = (
    (re.compile(r"^(.+) 接入配置已更新$"), r"\1 integration settings were updated"),
    (re.compile(r"^已保存 (\d+) 个探测目标$"), r"\1 probe targets were saved"),
    (re.compile(r"^登录背景类型已设为 (.+)$"), r"Sign-in background type set to \1"),
    (re.compile(r"^告警 (.+) 已确认$"), r"Alert \1 was acknowledged"),
    (re.compile(r"^已确认 (\d+) 条告警$"), r"\1 alerts were acknowledged"),
)


def audit_action_en(action: str) -> str:
    return ACTIONS_EN.get(action, action)


def audit_detail_en(detail: str) -> str:
    text = detail.rstrip("。.")
    if text in DETAILS_EN:
        return DETAILS_EN[text]
    for pattern, replacement in DETAIL_PATTERNS:
        if pattern.fullmatch(text):
            return pattern.sub(replacement, text)
    return detail


def normalize_audit_search(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def audit_matches(search: str, action: str, actor: str, source_ip: str, detail: str) -> bool:
    return any(search in normalize_audit_search(value) for value in (
        action, actor, source_ip, detail, audit_action_en(action), audit_detail_en(detail),
    ))
