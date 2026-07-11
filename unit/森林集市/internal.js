
let { config } = require('../../config.js')(runtime, global)
let singletonRequire = require('../../lib/SingletonRequirer.js')(runtime, global)
let automator = singletonRequire('Automator')
let commonFunctions = singletonRequire('CommonFunction')
let FloatyInstance = singletonRequire('FloatyUtil')
let logFloaty = singletonRequire('LogFloaty')
let { logInfo, errorInfo, warnInfo, debugInfo, infoLog, debugForDev, clearLogFile, flushAllLogs } = singletonRequire('LogUtils')
let widgetUtils = singletonRequire('WidgetUtils')
let alipayUnlocker = singletonRequire('AlipayUnlocker')

module.exports = {
  Market: Market,
}


function Market () {
  const _this = this
  function startApp (reopen) {
    app.startActivity({
      action: 'VIEW',
      data: 'alipays://platformapi/startapp?appId=2019072665961762&page=pages%2Fant%2Findex%3F%24%24_share_uid%3Dr9D1H0xiGjQBASQIhCEXn3n9%26%24%24_utm_medium%3D3&enbsv=0.2.2503111357.59&chInfo=ch_share__chsub_CopyLink&fxzjshareChinfo=ch_share__chsub_CopyLink&shareTimestamp=1741767573196&apshareid=619a04b2-24f0-4035-8170-761779f0c278&shareBizType=H5App_XCX',
      packageName: config.package_name
    })
    FloatyInstance.setFloatyInfo({ x: config.device_width / 2, y: config.device_height / 2 }, "查找是否有'打开'对话框")
    let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
    if (confirm) {
      automator.clickCenter(confirm)
    }
    if (openAlipayMultiLogin(reopen)) {
      return
    }
    if (config.is_alipay_locked) {
      sleep(1000)
      alipayUnlocker.unlockAlipay()
    }
    if (widgetUtils.widgetWaiting('绿色商品', null)) {
      checkDialogAndClose()
      // 关闭首购红包弹窗（方案A：点击领取）
      closeFirstPurchaseRedPack()
      return true
    }
    warnInfo(['无法校验 绿色商品 控件，可能没有正确打开'], true)
    return false
  }

  function openAlipayMultiLogin (reopen) {
    if (config.multi_device_login && !reopen) {
      debugInfo(['已开启多设备自动登录检测，检查是否有 进入支付宝 按钮'])
      let entryBtn = widgetUtils.widgetGetOne(/^进入支付宝$/, 1000)
      if (entryBtn) {
        automator.clickCenter(entryBtn)
        sleep(1000)
        startApp()
        return true
      } else {
        debugInfo(['未找到 进入支付宝 按钮'])
      }
    }
  }


  this.isDone = function () {
    return widgetUtils.widgetGetOne('下单得能量', 1000, false, false, matcher => {
      return matcher.className('android.widget.TextView').filter(node => node && node.bounds().left > config.device_width / 2)
    })
  }

  this.doHangOut = function (retry) {
    let errorMsg = ''
    let tryLimit = 3
    // 音量上键退出脚本
    threads.start(function () {
      events.observeKey()
      events.on("key_down", function (keyCode, event) {
        if (keyCode === 24) {
          logFloaty.pushLog('用户按音量上键，退出森林集市')
          exit()
        }
      })
    })
    let taskRunner = new TaskRunner()
    while (tryLimit > 0) {
      // 注释掉：任务完成由 taskRunner.run() 匹配不到执行器来判断
      // if (this.isDone()) {
      //   logFloaty.pushLog('今日任务已经完成了 退出执行')
      //   sleep(1000)
      //   return true
      // }
      if (!taskRunner.run()) {
        debugInfo(['未能匹配到任何执行器'])
        // 确认还在界面中，等待3s后重试一次
        if (widgetUtils.widgetCheck('绿色商品', 2000)) {
          sleep(3000)
          if (!taskRunner.run()) {
            logFloaty.pushLog('仍在森林集市界面且无任务可执行，任务已完成')
            return true
          }
        } else {
          logFloaty.pushErrorLog('当前不在森林集市界面，重新打开')
          commonFunctions.minimize()
          if (!startApp()) {
            logFloaty.pushErrorLog('重新打开森林集市失败')
            return false
          }
        }
      }
      // 注释掉：放弃按钮 遮挡界面
      // let drop = widgetUtils.widgetGetOne('放弃', 3000)
      // if (drop) {
      //   automator.clickCenter(drop)
      //   sleep(1000)
      // }
      // 注释掉：TaskRunner.run() 中已有 checkDialogAndClose()
      // logFloaty.pushLog('检查是否有关闭弹窗按钮')
      // let centerCloseBtn = selector().clickable().filter(node => {
      //   let bd = node.bounds()
      //   let rate = bd.width() / bd.height()
      //   return rate >= 0.98 && rate <= 1.02 && bd.centerX() == config.device_width / 2 && bd.centerY() > config.device_height / 2
      // }).findOne(2000)
      // if (centerCloseBtn) {
      //   logFloaty.pushLog('找到关闭弹窗按钮')
      //   centerCloseBtn.click()
      // }
    }
    // tryLimit 耗尽，走失败流程
    this._hangOutErrorMsg = '执行次数超过指定次数，可能存在页面阻断'
    return false
  }

  this.doHangOutWithTimeout = function (timeoutMs, startTime) {
    let remaining = timeoutMs - (new Date().getTime() - startTime)
    if (remaining <= 0) {
      this._hangOutErrorMsg = '执行超时'
      logFloaty.pushErrorLog('森林集市执行超时')
      return false
    }
    return this.doHangOut()
  }

  this.exec = function () {
    let retry = 0
    let opened = false
    let success = false
    let errorMsg = ''
    let errorType = 0
    let timeoutMs = 5 * 60 * 1000  // 全局超时5分钟
    let startTime = new Date().getTime()
    logFloaty.pushLog('准备打开森林集市')
    while ((opened = startApp()) == false && retry++ < 3) {
      if (checkIfInVerify()) {
        errorMsg = '触发身份验证'
        break
      }
      warnInfo('打开森林集市失败')
      sleep(1000)
      home()
      sleep(1000)
    }
    if (opened) {
      try {
        // 在 doHangOut 中嵌入超时检查
        let hangOutResult = this.doHangOutWithTimeout(timeoutMs, startTime)
        if (hangOutResult) {
          success = true
        } else {
          errorMsg = this._hangOutErrorMsg || '任务执行失败，稍后重试'
          errorType = 3
        }
      } catch (e) {
        errorInfo(['任务执行异常：{}', e])
        errorMsg = '任务执行异常' + e
        errorType = 2
      }
    } else {
      logFloaty.pushErrorLog('打开森林集市界面失败')
      errorMsg = '打开森林集市界面失败'
      errorType = 1
    }
    return {
      success: success,
      errorMsg: errorMsg,
      errorType: errorType,
    }
  }

}

function BrowserExecutor () {
  this.check = function () {
    return !!widgetUtils.widgetGetOne('浏览商品\\d+s得能量', 2000)
  }

  this.execute = function () {
    logFloaty.pushLog('找到了倒计时控件，开始浏览商品')
    let maxTry = 2
    let breakLoop = false
    while (maxTry-- > 0 && widgetUtils.widgetGetOne('浏览商品\\d+s得能量', 1000)) {
      // 只保持在 greenItem 中
      let target = widgetUtils.widgetGetById('greenItem', 1000)
      if (target) {
        target.click()
        sleep(2000)
      }
      // 先下滑再上滑，循环8次
      let scrollRound = 8
      while (scrollRound-- > 0) {
        let h = config.device_height
        // 下滑
        automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
        sleep(500)
        // 上滑
        automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
        sleep(500)
      }
      // 每轮8次滑动结束后判断任务是否完成
      if (checkAndClickIfTaskEnd()) {
        breakLoop = true
      }
      if (breakLoop) {
        break
      }
    }
  }
}


function ClickExecutor () {
  this.check = function () {
    return !!widgetUtils.widgetGetOne('点击', 2000)
  }

  this.execute = function () {
    logFloaty.pushLog('点击商品进行浏览')
    let maxTry = 2
    let breakLoop = false
    while (maxTry-- > 0 && widgetUtils.widgetGetOne('点击', 1000)) {
      // 每轮点击3次商品
      let clickCount = 3
      while (clickCount-- > 0) {
        if (breakLoop) {
          break
        }
        if (!this.clickGoodDetail()) {
          logFloaty.pushWarningLog('点击商品失败，尝试切换到其他tab')
          let greenfood = widgetUtils.widgetGetById('greenFood', 1000)
          if (greenfood) {
            greenfood.click()
            sleep(1000)
            this.clickGoodDetail()
          }
        }
      }
      // 每轮3次点击结束后判断任务是否完成
      if (checkAndClickIfTaskEnd()) {
        breakLoop = true
      }
      if (breakLoop) {
        break
      }
    }
  }

  this.clickGoodDetail = function () {
    let clickBtn = widgetUtils.widgetGetOne('到手价|入会价|优惠后|补贴后')
    if (clickBtn) {
      logFloaty.pushLog('随机点击一个商品')
      clickBtn.click()
      sleep(2000)
      back()
      sleep(1000)
      return true
    } else {
      logFloaty.pushErrorLog('未找到可点击商品')
    }
    return false
  }
}

// 注释掉：RewardExecutor 已废弃，领取奖励由 checkAndClickIfTaskEnd 处理
// function RewardExecutor () {
// 
//   this.check = function () {
//     return !!widgetUtils.widgetGetOne('可领取', 2000)
//   }
// 
//   this.execute = function () {
//     let collectReword = widgetUtils.widgetGetOne('可领取', 1000)
//     if (collectReword) {
//       collectReword.click()
//       logFloaty.pushLog('点击了领取奖励，等待界面加载, 2s')
//       let limit = 2
//       while (limit-- > 0) {
//         sleep(1000)
//         logFloaty.replaceLastLog('点击了领取奖励，等待界面加载, ' + limit + 's')
//       }
//     } else {
//       logFloaty.pushWarningLog('未能找到领取奖励按钮，可能界面有阻断')
//     }
//   }
// }

function TaskRunner () {
  this.executors = [new ClickExecutor(), new BrowserExecutor()]
  this.run = function () {
    // 注释掉：弹窗只在进入页面和退出时处理，任务执行中不会有弹窗
    // checkDialogAndClose()
    for (let executor of this.executors) {
      if (executor.check()) {
        executor.execute()
        return true
      }
    }
    return false
  }
}

function checkAndClickIfTaskEnd () {
  let taskEnd = widgetUtils.widgetGetOne('任务已完成.*立即领取', 1000)
  if (taskEnd) {
    // 延迟点击
    sleep(1000)
    automator.clickCenter(taskEnd)
    sleep(3000)
    return true
  }
  return false
}

function checkIfInVerify () {
  if (widgetUtils.widgetCheck('.*身份验证.*', 1000)) {
    logFloaty.pushErrorLog('触发身份验证机制，等待是否自动处理')
    let stillVerifying = true
    let waitCount = 3
    while (waitCount-- > 0) {
      logFloaty.replaceLastLog('触发身份验证机制，等待是否自动处理 ' + (waitCount + 1) + 's')
      sleep(1000)
      if (!widgetUtils.widgetCheck('.*身份验证.*', 1000)) {
        stillVerifying = false
        break
      }
    }
    if (stillVerifying) {
      logFloaty.pushErrorLog('触发身份验证，无法执行')
      home()
      return true
    }
  }
  return false
}

/**
 * 关闭首购红包弹窗（方案A：点击"点击领取"）
 */
function closeFirstPurchaseRedPack () {
  let claimBtn = widgetUtils.widgetGetOne('点击领取', 2000)
  if (claimBtn) {
    logFloaty.pushLog('发现首购红包弹窗，点击领取')
    automator.clickCenter(claimBtn)
    sleep(2000)
  } else {
    debugInfo(['未发现首购红包弹窗'])
  }
}


function checkDialogAndClose () {
  logFloaty.pushLog('检查是否存在关闭弹窗按钮')
  let targetCloseBtn = selector().filter(node => {
    if (!node || !node.bounds()) {
      return false
    }
    let bd = node.bounds()
    let rate = bd.width() / bd.height()
    let centerX = bd.centerX()
    let centerY = bd.centerY()
    return rate >= 0.9 && rate <= 1.1 && Math.abs(centerX - config.device_width / 2) < 10 && centerY > config.device_height / 2
  }).findOne(1000)
  if (targetCloseBtn) {
    logFloaty.pushLog('找到关闭弹窗按钮')
    automator.clickCenter(targetCloseBtn)
    sleep(1000)
  }
}