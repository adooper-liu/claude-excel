/**
 * 后端基地址（单一真相，前端所有后端 fetch 的唯一入口）。
 *
 * 用 127.0.0.1 而非 localhost：本机 localhost 会优先解析成 IPv6 ::1，
 * 而后端只监听 IPv4 127.0.0.1（backend/server.py host="127.0.0.1"）。
 * 走 ::1 的连接无人应答、挂死在 SYN_SENT，导致 fetch 间歇性抛
 * Failed to fetch → 任务窗格显示「后端连不上」。证书 SAN 同时覆盖
 * 127.0.0.1（IP）与 localhost（DNS），此处不受证书影响。
 */
export const API_BASE = "https://127.0.0.1:8765";
