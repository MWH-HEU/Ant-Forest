/**
 * SwitchToApp - 切入指定 app 公共函数库
 *
 * 文本切入: recents() 卡片视图 + 文本匹配（首选）
 * 冷启动: launchPackage 直接启动（fallback）
 *
 * 用法：
 *   let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)
 *   SwitchToApp.switchToApp({ pkg: 'com.eg.android.AlipayGphone', cardText: '支付宝', onLog: debugInfo })
 */
module.exports = function (runtime, global) {
  let sRequire = require('./SingletonRequirer.js')(runtime, global)
  let automator = sRequire('Automator')
  let { debugInfo } = sRequire('LogUtils')

  /**
   * 切入指定 app
   * @param {Object} opts
   * @param {string} opts.pkg - 目标 app 包名（必传）
   * @param {string} [opts.cardText] - 卡片视图里匹配的文本（文本切入用，默认取 pkg 对应 app 名）
   * @param {function(string)} [opts.onLog] - 日志回调，默认 debugInfo
   * @returns {boolean} 是否切入成功
   */
  function switchToApp (opts) {
    opts = opts || {}
    let log = opts.onLog || debugInfo
    let pkg = opts.pkg
    if (!pkg) {
      log('未指定目标包名')
      return false
    }

    log('====== 开始切入 ' + pkg + ' ======')
    log('目标包名: ' + pkg)

    // 文本切入 (首选): recents() 打开卡片视图，点击目标卡片
    try {
      log('文本切入 (首选): recents() 打开卡片视图，查找目标卡片')
      recents()
      sleep(1500)

      let cardText = opts.cardText || pkg
      let targetCard = null
      try {
        targetCard = textContains(cardText).findOne(2000)
      } catch (e) {}

      if (targetCard) {
        log('  找到目标卡片，点击切入')
        automator.clickCenter(targetCard)
        sleep(1500)
        if (currentPackage() === pkg) {
          log('  切入成功，当前包名: ' + currentPackage())
          return true
        }
      } else {
        log('  卡片视图中未找到目标卡片')
        back()
        sleep(500)
      }
    } catch (e) {
      log('  文本切入异常: ' + e)
      try { back() } catch (e2) {}
      sleep(500)
    }

    // 冷启动 (fallback): launchPackage 直接启动
    log('冷启动 (fallback): launchPackage 直接启动')
    try {
      app.launchPackage(pkg)
      sleep(1500)
      if (currentPackage() === pkg) {
        log('  切入成功，当前包名: ' + currentPackage())
        return true
      }
    } catch (e) {
      log('  冷启动异常: ' + e)
    }

    log('  切入 ' + pkg + ' 失败')
    return false
  }

  return {
    switchToApp: switchToApp
  }
}
