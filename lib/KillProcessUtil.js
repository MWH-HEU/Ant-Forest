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
 * @returns {object} { success: boolean, code: number, result: string }
 */
KillProcessUtil.prototype.kill = function (packageName) {
  let result = $shizuku('am force-stop ' + packageName)
  return {
    success: result.code === 0,
    code: result.code,
    result: result.result
  }
}

/**
 * 杀掉多个包名的进程
 * @param {Array<string|object>} packageList - 包名数组，或 [{pkg, name}] 对象数组
 * @returns {Array<object>} 每个包名的执行结果
 */
KillProcessUtil.prototype.killMultiple = function (packageList) {
  let results = []
  packageList.forEach(item => {
    let pkg = typeof item === 'string' ? item : item.pkg
    let name = typeof item === 'string' ? pkg : (item.name || pkg)
    let before = this.isRunning(pkg)
    let killResult = this.kill(pkg)
    results.push({
      name: name,
      packageName: pkg,
      beforeRunning: before,
      success: killResult.success,
      code: killResult.code
    })
  })
  return results
}

module.exports = new KillProcessUtil()
