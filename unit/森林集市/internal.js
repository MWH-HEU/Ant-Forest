
let { config } = require('../../config.js')(runtime, global)
let singletonRequire = require('../../lib/SingletonRequirer.js')(runtime, global)
let automator = singletonRequire('Automator')
let commonFunctions = singletonRequire('CommonFunction')
let FloatyInstance = singletonRequire('FloatyUtil')
let logFloaty = singletonRequire('LogFloaty')
let { logInfo, errorInfo, warnInfo, debugInfo, infoLog, debugForDev, clearLogFile, flushAllLogs } = singletonRequire('LogUtils')
let widgetUtils = singletonRequire('WidgetUtils')
let alipayUnlocker = singletonRequire('AlipayUnlocker')

function taskLog(msg) {
  logFloaty.pushLog(msg)
}

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
    let i = 1
    let taskRunner = new TaskRunner()
    do {
      // 判断是否在森林集市页面，不在则重新进入
      if (!widgetUtils.widgetCheck('绿色商品', 2000)) {
        logFloaty.pushErrorLog('当前不在森林集市界面，重新打开')
        commonFunctions.minimize()
        if (!startApp()) {
          logFloaty.pushErrorLog('重新打开森林集市失败')
          return false
        }
        // 重新进入后重试本轮，不计入次数
        continue
      }
      if (!taskRunner.run()) {
        // 未匹配到任何执行器，确认在森林集市页面，说明任务已完成
        logFloaty.pushLog('在森林集市界面且无任务可执行，任务已完成')
        return true
      }
      i++
    } while (i <= 7)
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
    let timeoutMs = 4 * 60 * 1000  // 全局超时4分钟
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
    // 无论主任务是否成功，都收自己能量
    enterAntForest()
    for (let i = 1; i <= 6; i++) {
      taskLog('第' + i + '/6次收自己能量')
      collectOwnEnergy()
      if (i < 6) sleep(5000)
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
      // 每轮8次滑动结束后，上滑到最上面
      let h = config.device_height
      automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
      sleep(500)
      // 判断任务是否完成
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

function RewardExecutor () {

  this.check = function () {
    return !!widgetUtils.widgetGetOne('可领取', 2000)
  }

  this.execute = function () {
    // // 先滑动到最上部，确保"可领取"在可视区域
    // let h = config.device_height
    // automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
    // sleep(500)
    // // 等待5s让界面稳定
    // logFloaty.pushLog('滑动到顶部，等待界面稳定, 5s')
    // let limit = 5
    // while (limit-- > 0) {
    //   sleep(1000)
    //   logFloaty.replaceLastLog('滑动到顶部，等待界面稳定, ' + limit + 's')
    // }
    let collectReword = widgetUtils.widgetGetOne('可领取', 1000)
    if (collectReword) {
      collectReword.click()
      logFloaty.pushLog('点击了领取奖励，等待界面加载, 5s')
      let limit = 5
      while (limit-- > 0) {
        sleep(1000)
        logFloaty.replaceLastLog('点击了领取奖励，等待界面加载, ' + limit + 's')
      }
    } else {
      logFloaty.pushWarningLog('未能找到领取奖励按钮，可能界面有阻断')
    }
  }
}

function TaskRunner () {
  this.executors = [new BrowserExecutor(), new ClickExecutor(), new RewardExecutor()]
  this.run = function () {
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
  // 先确认弹窗是否存在（查找"首购红包"或"点击领取"文本）
  if (!widgetUtils.widgetGetOne('首购红包|点击领取', 2000)) {
    debugInfo(['未发现首购红包弹窗'])
    return
  }
  logFloaty.pushLog('发现首购红包弹窗，尝试关闭')
  // 查找弹窗下方的关闭按钮（X）
  let closeBtn = selector().filter(node => {
    if (!node || !node.bounds()) {
      return false
    }
    let bd = node.bounds()
    let rate = bd.width() / bd.height()
    let centerX = bd.centerX()
    let centerY = bd.centerY()
    return rate >= 0.8 && rate <= 1.2 && centerX > config.device_width * 0.4 && centerX < config.device_width * 0.7 && centerY > config.device_height * 0.5 && centerY < config.device_height * 0.8
  }).findOne(2000)
  if (closeBtn) {
    logFloaty.pushLog('找到关闭按钮，点击关闭')
    automator.clickCenter(closeBtn)
    sleep(1500)
  } else {
    // 如果找不到X按钮，尝试点击弹窗外部区域关闭
    logFloaty.pushWarningLog('未找到关闭按钮，尝试点击弹窗外部')
    automator.click(config.device_width / 2, config.device_height * 0.85)
    sleep(1500)
  }
}


/**
 * 进入蚂蚁森林
 */
function enterAntForest() {
  taskLog('进入蚂蚁森林')

  commonFunctions.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunctions.readyForAlipayWidgets()

  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }

  if (!widgetUtils.homePageWaiting()) {
    taskLog('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

/**
 * 收取自己的能量
 */
function collectOwnEnergy() {
  if (config.not_collect_self) {
    debugInfo('配置为不收取自己能量，跳过')
    return
  }

  let ReviveBaseScanner = require('../../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)
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