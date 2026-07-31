/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 收自己能量子脚本
 * 进入蚂蚁森林 → 等待2s → 循环40次（每次间隔5s）收集自己能量
 * 第6/11/16/21/26/31/36次：返回上一页 → 点击"蚂蚁森林"重新进入，防止页面卡死
 * 退出：音量上键 / 进入失败 / 循环结束 → 返回桌面 → 杀掉支付宝 → 移除任务
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
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

  if (!widgetUtils.homePageWaiting()) {
    errorInfo('进入蚂蚁森林失败')
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

  if (!widgetUtils.homePageWaiting()) {
    warnInfo('不在首页，重新进入蚂蚁森林')
    enterAntForest()
  }

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
      if (!findAndClickByTextVisible(/蚂蚁森林/)) {
        warnInfo('未找到"蚂蚁森林"入口，重新进入蚂蚁森林')
        if (!enterAntForest()) {
          exitScript()
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
