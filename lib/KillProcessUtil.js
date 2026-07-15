/*
 * 根据包名杀掉进程工具
 * 依赖 Shizuku 服务执行 am force-stop
 */
let { config } = require('../config.js')(runtime, global)

function KillProcessUtil () {
}

/**
 * 检查 Shizuku 是否运行
 */
KillProcessUtil.prototype.isShizukuRunning = function () {
  return $shizuku.isRunning()
}

/**
 * 检查指定包名的进程是否在运行
 * @param {string} packageName - 应用包名
 * @returns {boolean} true=运行中, false=已停止
 */
KillProcessUtil.prototype.isRunning = function (packageName) {
  let result = $shizuku('ps -A | grep ' + packageName)
  return !!result.result
}

/**
 * 杀掉指定包名的进程
 * @param {string} packageName - 应用包名
 * @returns {boolean} true=成功, false=失败
 */
KillProcessUtil.prototype.kill = function (packageName) {
  let result = $shizuku('am force-stop ' + packageName)
  return result.code === 0
}

/**
 * 批量杀掉多个包名的进程，每次kill后调用回调输出日志
 * 
 * 注意：$shizuku 连续调用之间必须有 UI 操作（如 LogFloaty.pushLog）作为间隔，
 * 否则会卡住。因此不能先全部执行完再统一输出结果，必须在每次 kill 后
 * 通过 onResult 回调输出日志。
 * 
 * @param {Array} packageList - [{pkg, name}] 或 [pkg1, pkg2]
 * @param {function} onResult - 每次kill后的回调 function(name, success)
 * @returns {Array} [{name, success}]
 */
KillProcessUtil.prototype.killMultiple = function (packageList, onResult) {
  let results = []
  for (let i = 0; i < packageList.length; i++) {
    let item = packageList[i]
    let pkg = typeof item === 'string' ? item : item.pkg
    let name = typeof item === 'string' ? pkg : (item.name || pkg)
    let success = this.kill(pkg)
    results.push({ name: name, success: success })
    if (onResult) {
      onResult(name, success)
    }
  }
  return results
}

module.exports = new KillProcessUtil()
