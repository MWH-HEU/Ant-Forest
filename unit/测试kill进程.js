/*
 * 测试kill进程脚本
 * 手动打开应用后运行此脚本，检查是否真正关闭了进程
 * 日志输出到悬浮窗
 */

let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let LogFloaty = sRequire('LogFloaty')

if (!$shizuku.isRunning()) {
  LogFloaty.pushLog('错误: Shizuku 未运行，请在抽屉界面开启 Shizuku 服务')
  exit()
}

let packages = [
  { pkg: 'com.eg.android.AlipayGphone', name: '支付宝' },
  { pkg: 'com.taobao.taobao', name: '淘宝' },
  { pkg: 'com.sankuai.meituan', name: '美团' },
  { pkg: 'com.taobao.idlefish', name: '闲鱼' },
  { pkg: 'com.taobao.etao', name: '一淘' },
  { pkg: 'com.taobao.trip', name: '飞猪' },
  { pkg: 'com.autonavi.minimap', name: '高德地图' }
]

LogFloaty.show()

LogFloaty.pushLog('===== 检查进程运行状态 =====')
packages.forEach(p => {
  let r = $shizuku('ps -A | grep ' + p.pkg)
  LogFloaty.pushLog(p.name + ': ' + (r.result ? '运行中' : '已停止'))
})

LogFloaty.pushLog('')
LogFloaty.pushLog('===== 开始 kill 进程 =====')
packages.forEach(p => {
  let r = $shizuku('am force-stop ' + p.pkg)
  LogFloaty.pushLog(p.name + ' → ' + (r.code === 0 ? '✓ 已杀掉' : '✗ 失败'))
})

sleep(2000)

LogFloaty.pushLog('')
LogFloaty.pushLog('===== 再次检查进程运行状态 =====')
packages.forEach(p => {
  let r = $shizuku('ps -A | grep ' + p.pkg)
  LogFloaty.pushLog(p.name + ': ' + (r.result ? '仍在运行' : '✓ 已停止'))
})

LogFloaty.pushLog('')
LogFloaty.pushLog('测试完成')
