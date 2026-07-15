var { default_config, config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
var configStorage = storages.create(_storage_name)
let FileUtils = singletonRequire('FileUtils')
let commonFunctions = singletonRequire('CommonFunction')
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
configStorage.put("auto_start_sea", true)
toastLog("配置完毕done")
// 显示5秒倒计时弹窗
commonFunctions.showCommonDialogAndWait('神奇海洋')
let mainScriptPath = FileUtils.getRealMainScriptPath(true)
let childScriptPath = mainScriptPath + "/unit/神奇海洋.js"
engines.execScriptFile(childScriptPath, { path: mainScriptPath + "/unit/", arguments: { executeByTimeTask: true, needRelock: unlocker.needRelock() } })
sleep(1000)
let all = engines.all()
for (let i = 0; i < all.length; i++) {
  if ((all[i].getSource() + '') === childScriptPath) {
    while (!all[i].isDestroyed()) sleep(3000)
    break
  }
}
exit()
