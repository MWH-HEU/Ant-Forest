/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 收自己能量子脚本
 * 进入蚂蚁森林 → 等待2s → 循环40次（每次间隔5s）收集自己能量
 * 第6/11/16/21/26/31/36次：返回上一页 → 点击"蚂蚁森林"重新进入，防止页面卡死
 * 退出：音量上键 / 进入失败 / 循环结束 → 返回桌面 → 杀掉支付宝 → 移除任务
 */let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)

function killApps() {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name, name: '支付宝' }
    ], function (name, success) {
      taskLog(name + ' → ' + (success ? '✓' : '✗'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

function exitScript() {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

// ============ 工具函数 ============

function taskLog(msg) {
  LogFloaty.pushLog(msg)
}

/**
 * 遍历可见控件，正则匹配文本并点击
 */
function findAndClickByTextVisible(pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd) {
        taskLog('找到"' + node.text + '"，点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

/**
 * 判断是否在支付宝首页（需同时找到"扫一扫 收付款 出行 卡包 蚂蚁森林"）
 */
function isOnAlipayHomePage() {
  let texts = ['扫一扫', '收付款', '出行', '卡包', '蚂蚁森林']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '支付宝首页', 3000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在支付宝首页')
      return false
    }
  }
  taskLog('检测到"扫一扫 收付款 出行 卡包 蚂蚁森林"，确认在支付宝首页')
  return true
}

/**
 * 判断是否在蚂蚁森林首页（需同时找到"蚂蚁森林"和"森林广场"）
 */
function isOnAntForestPage() {
  let result = widgetUtils.widgetWaiting('蚂蚁森林', '蚂蚁森林首页', 3000)
  if (!result) {
    taskLog('未检测到"蚂蚁森林"，不在蚂蚁森林界面')
    return false
  }
  let squareResult = widgetUtils.widgetWaiting('森林广场', '蚂蚁森林首页', 3000)
  if (!squareResult) {
    taskLog('未检测到"森林广场"，不在蚂蚁森林界面')
    return false
  }
  taskLog('检测到"蚂蚁森林"和"森林广场"，确认在蚂蚁森林界面')
  return true
}

/**
 * 进入蚂蚁森林
 */
function enterAntForest() {
  taskLog('进入蚂蚁森林')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }

  // while 退出后，waitCount >= 10 说明超时未进入首页
  if (waitCount >= 10) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  taskLog('进入蚂蚁森林成功')
  return true
}

/**
 * 收取自己的能量（调用前需确保已在蚂蚁森林首页）
 */
function collectOwnEnergy() {
  let ReviveBaseScanner = require('../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)
}

// ============ 主流程 ============

function main() {
  infoLog('收自己能量脚本启动', true)

  // 音量上键退出脚本
  threads.start(function () {
    events.observeKey()
    events.on("key_down", function (keyCode, event) {
      if (keyCode === 24) {
        toastLog('用户按音量上键，退出脚本')
        killApps()
        runningQueueDispatcher.removeRunningTask()
        exit()
      }
    })
  })

  // 首次进入蚂蚁森林
  if (!enterAntForest()) {
    exitScript()
  }
  sleep(2000)

  for (let i = 1; i <= 40; i++) {
    // 第6/11/16/21/26/31/36次：返回上一页 → 点击"蚂蚁森林"重新进入
    if ((i - 1) % 5 === 0 && i > 5) {
      back()
      sleep(800)
      // 判断是否回到支付宝首页，不在则重新进入
      if (!isOnAlipayHomePage()) {
        warnInfo('未回到支付宝首页，重新进入蚂蚁森林')
        if (!enterAntForest()) {
          exitScript()
        }
      } else if (!findAndClickByTextVisible(/蚂蚁森林/)) {
        // 在支付宝首页但找不到"蚂蚁森林"入口，重新进入
        warnInfo('未找到"蚂蚁森林"入口，重新进入蚂蚁森林')
        if (!enterAntForest()) {
          exitScript()
        }
      } else {
        // 点击"蚂蚁森林"后判断是否进入蚂蚁森林首页
        if (!isOnAntForestPage()) {
          warnInfo('未进入蚂蚁森林首页，重新进入蚂蚁森林')
          if (!enterAntForest()) {
            exitScript()
          }
        }
      }
      sleep(2000)
    }

    taskLog('第' + i + '/40次收能量')
    collectOwnEnergy()
    if (i < 40) sleep(5000)
  }

  exitScript()
}

main()
