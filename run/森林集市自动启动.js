/*
 * 森林集市父脚本 - 自动启动森林集市子脚本
 * 架构参考神奇鱼塘：父脚本负责解锁、音量控制、静音、倒计时弹窗、启动子脚本、等待子脚本结束、锁屏；
 * 子脚本（森林集市.js）负责纯核心任务代码。
 */
var { default_config, config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
var configStorage = storages.create(_storage_name)
let FileUtils = singletonRequire('FileUtils')
let commonFunctions = singletonRequire('CommonFunction')
let automator = singletonRequire('Automator')
let { logInfo, errorInfo, warnInfo, debugInfo, infoLog, debugForDev, clearLogFile, flushAllLogs } = singletonRequire('LogUtils')
config.not_lingering_float_window = true
if (!commonFunctions.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
// 设置自动静音
config.mute_exec = true
let unlocker = require('../lib/Unlock.js')
unlocker.exec()
configStorage.put("auto_start_market", true)
toastLog("配置完毕done")
// 显示5秒倒计时弹窗
commonFunctions.showCommonDialogAndWait('森林集市')
let mainScriptPath = FileUtils.getRealMainScriptPath(true)
let childScriptPath = mainScriptPath + "/run/森林集市.js"
engines.execScriptFile(childScriptPath, { path: mainScriptPath + "/run/", arguments: { executeByTimeTask: true } })
sleep(1000)
let all = engines.all()
for (let i = 0; i < all.length; i++) {
  if ((all[i].getSource() + '') === childScriptPath) {
    let waitStart = new Date().getTime()
    while (!all[i].isDestroyed()) {
      if (new Date().getTime() - waitStart > 40 * 60 * 1000) {
        debugInfo('子脚本执行超时40分钟，强制退出')
        break
      }
      sleep(3000)
    }
    break
  }
}
// 子脚本执行完毕，锁屏
if (config.auto_lock === true && unlocker.needRelock() === true) {
  debugInfo('重新锁定屏幕')
  automator.lockScreen()
}
exit()
