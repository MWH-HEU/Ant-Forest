/*
 * 神奇鱼塘任务脚本
 * 功能：
 * 1. 打开闲鱼神奇鱼塘
 * 2. 通过OCR识别"得能量"并点击进入任务页面
 * 3. 只完成3个任务：
 *    - "去浏览"分支（同行含"点击1个商品进入详情页"）：
 *      点击进入 → 等待2s → 下滑一次 → 识别"抵后价"并点击 → 返回两次
 *      未识别到则继续下滑重复，最多3次
 *    - "去完成"分支（同行含"参与绿色科普答题"）：
 *      点击 → 等待2s → 选择第一个选项 → 点击提交答案
 *    - "去完成"分支（同行含"去蚂蚁森林收更多能量"）：
 *      点击 → 等待2s → 进入蚂蚁森林 → 返回神奇鱼塘
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let FloatyInstance = sRequire('FloatyUtil')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let killProcessUtil = require('../lib/KillProcessUtil.js')

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' },
      { pkg: 'com.taobao.idlefish', name: '闲鱼' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

let localOcrUtil = require('../lib/LocalOcrUtil.js')
let FileUtils = require('../lib/prototype/FileUtils.js')

runningQueueDispatcher.addRunningTask()

// 日志文件
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/yutang.log'
function writeLog (msg) {
  try {
    if (!_logFile) {
      _logFile = open(_logFilePath, 'w')
    }
    if (_logFile) {
      let now = new Date()
      _logFile.writeline('[' + now.toLocaleString() + '] ' + msg)
      _logFile.flush()
    }
  } catch (e) {}
}

// 调试日志（悬浮窗显示 + 写入日志文件）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
  // writeLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 注册自动移除运行中任务
commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

// ============ 工具函数 ============

function goBack () {
  back()
  sleep(800)
}

function getNodeText (node) {
  try {
    let t = node.text()
    return t ? t.toString() : ''
  } catch (e) {
    return ''
  }
}

/**
 * 从缓存中查找指定关键字的y坐标（未使用，保留备用）
 */
function getCachedY (keyword, cachedTexts) {
  try {
    for (let i = 0; i < cachedTexts.length; i++) {
      if (cachedTexts[i].text.indexOf(keyword) >= 0) {
        return cachedTexts[i].y
      }
    }
  } catch (e) {}
  return -1
}

function hasTextInSameRow (bounds, keyword, cachedTexts) {
  try {
    // 从缓存中查找同行关键字（未使用，保留备用）
    if (cachedTexts) {
      for (let i = 0; i < cachedTexts.length; i++) {
        let item = cachedTexts[i]
        if (item.text.indexOf(keyword) >= 0) {
          if (Math.abs(item.y - bounds.centerY()) < 200) {
            return true
          }
        }
      }
    }
  } catch (e) {}
  return false
}
// ============ 神奇鱼塘操作 ============

/**
 * 打开闲鱼神奇鱼塘
 * 通过支付宝scheme打开闲鱼小程序，然后跳转到神奇鱼塘页面
 */
function openFishPool () {
  taskLog("准备打开闲鱼神奇鱼塘")

  commonFunction.backHomeIfInVideoPackage()

  // 通过intent直接打开闲鱼app并跳转到神奇鱼塘页面
  // 指定packageName为闲鱼，系统不会弹出选择器
  app.startActivity({
    action: "VIEW",
    data: "https://pages.goofish.com/sharexy?url=https%3A%2F%2Fssr.m.goofish.com%2Fwow%2Fmoyu%2Fmoyu-project%2Ffish-pool%2Fpages%2Fhome%3Fx-ssr%3Dtrue%26_from__%3Dmain%26x-cur%3DCNY%26x-lang%3Dzh-CN%26x-tz%3DAsia%252FShanghai%26x-cs%3DCN",
      packageName: "com.taobao.idlefish"
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  taskLog("等待神奇鱼塘页面加载")
  sleep(3000)

  let checkResult = widgetUtils.widgetWaiting(".*(神奇鱼塘|得能量|鱼塘绿色度|投喂).*", 5000)
  if (checkResult) {
    taskLog("神奇鱼塘页面已加载")
    return true
  }

  taskLog("进入神奇鱼塘失败")
  return false
}
function clickGetEnergy () {
  taskLog('通过OCR识别"得能量"')

  if (localOcrUtil.enabled) {

    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, parseInt(config.device_height * 0.5), config.device_width, parseInt(config.device_height * 0.5)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '得能量')
      screen.recycle()
      if (results && results.length > 0) {
        for (let r = 0; r < results.length; r++) {
          let match = results[r]
          if (match.label.indexOf('得能量') >= 0) {
            let bounds = match.bounds
            taskLog('OCR找到"得能量": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            return true
          }
        }
      }
    }
  }

  taskLog('未找到"得能量"入口')
  return false
}

/**
 * 等待任务页面加载（检测"浏览商品详情页"或"绿色答题"）
 */
function waitForTaskPage () {
  taskLog('等待任务页面加载')
  let checkResult = widgetUtils.widgetWaiting('.*(得更多能量|去浏览|去完成|绿色科普|蚂蚁森林).*', 5000)
  if (checkResult) {
    taskLog('任务页面已加载')
    sleep(1000)
    return true
  }
  taskLog('任务页面加载超时')
  return false
}

// ============ 任务分支 ============

/**
 * 执行浏览商品任务：点击"去浏览"→下滑查找"抵后价"（OCR优先，控件兜底）→返回
 */
function doBrowseTask (bounds) {
  taskLog('执行"去浏览"任务 - 点击1个商品进入详情页')

  automator.click(bounds.centerX(), bounds.centerY())
  sleep(2000)

  let maxScroll = 3
  for (let s = 0; s < maxScroll; s++) {
    taskLog('浏览商品 第' + (s + 1) + '次下滑')

    let h = config.device_height
    automator.randomScrollDown(0.6 * h, 0.7 * h, 0.2 * h, 0.3 * h)
    sleep(1500)

    let clicked = false

    // 先OCR识别"抵后价"
    if (localOcrUtil.enabled) {
      commonFunction.requestScreenCaptureOrRestart()
      sleep(500)
      let screen = commonFunction.captureScreen()
      if (screen) {
        let results = localOcrUtil.recognizeWithBounds(screen, [0, 0, config.device_width, config.device_height], '抵后价')
        screen.recycle()
        if (results && results.length > 0) {
          let match = results[0]
          taskLog('OCR找到"抵后价": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
          automator.click(match.bounds.centerX(), match.bounds.centerY())
          sleep(2000)
          clicked = true
        }
      }
    }

    // OCR未找到，控件查找兜底
    if (!clicked) {
      try {
        let allNodes = className('android.widget.Button').find()
        if (allNodes) {
          for (let i = 0; i < allNodes.size(); i++) {
            try {
              let node = allNodes.get(i)
              let t = node.text() || node.desc()
              if (t && t.toString().indexOf('抵后价') >= 0) {
                let nb = node.bounds()
                taskLog('控件找到"抵后价": 点击: (' + nb.centerX() + ', ' + nb.centerY() + ')')
                automator.click(nb.centerX(), nb.centerY())
                sleep(2000)
                clicked = true
                break
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        taskLog('控件查找"抵后价"异常: ' + e)
      }
    }

    if (clicked) {
      taskLog('已点击商品，返回两次')
      goBack()
      sleep(500)
      goBack()
      sleep(1000)
      return true
    }

    taskLog('未找到"抵后价"，继续下滑')
  }

  taskLog('浏览任务完成')
  goBack()
  sleep(500)
  goBack()
  sleep(1000)
  return true
}

/**
 * 执行答题任务：点击"去完成"→选择A选项→控件查找"提交答案"→控件查找"立即收能量"→返回
 */
function doQuizTask (bounds) {
  taskLog('执行"去完成"任务 - 参与绿色科普答题')

  automator.click(bounds.centerX(), bounds.centerY())
  sleep(2000)

  taskLog('等待答题弹窗加载')
  let quizPage = widgetUtils.widgetWaiting('.*(绿色答题|提交答案).*', 3000)
  if (!quizPage) {
    taskLog('未检测到答题页面，可能跳转到了其他应用，返回')
    goBack()
    sleep(1000)
    goBack()
    sleep(1000)
    return false
  }
  sleep(1000)

  // 选择第一个选项：匹配 A. B. C. 开头的选项
  taskLog('选择第一个选项')
  let optionClicked = false
  try {
    let allNodes = className('android.widget.TextView').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          if (text) {
            let nodeBounds = node.bounds()
            // 选项在屏幕中间区域，且以 A. B. C. 开头
            if (nodeBounds.centerY() > config.device_height * 0.25 && nodeBounds.centerY() < config.device_height * 0.65) {
              if (/^[A-C]\./.test(text)) {
                taskLog('点击第一个选项: ' + text)
                automator.clickCenter(node)
                sleep(1000)
                optionClicked = true
                break
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  if (!optionClicked) {
    taskLog('控件未找到选项，尝试点击屏幕中间偏上位置')
    automator.click(config.device_width / 2, config.device_height * 0.4)
    sleep(1000)
  }

  sleep(500)
  taskLog('点击"提交答案"')
  // 控件查找"提交答案"
  let submitBtn = textMatches('.*提交答案.*').findOne(2000)
  if (submitBtn) {
    taskLog('控件找到"提交答案"')
    automator.clickCenter(submitBtn)
    sleep(1000)
  } else {
    taskLog('控件未找到"提交答案"')
  }

  sleep(2000)

  // 点击"立即收能量"
  taskLog('点击"立即收能量"')
  let energyBtn = textMatches('.*立即收能量.*').findOne(2000)
  if (energyBtn) {
    taskLog('控件找到"立即收能量"')
    automator.clickCenter(energyBtn)
    sleep(1000)
  } else {
    taskLog('未找到"立即收能量"')
  }

  sleep(500)
  goBack()
  sleep(1000)

  return true
}

function doAntForestTask (bounds) {
  taskLog('执行"去完成"任务 - 去蚂蚁森林收更多能量')

  automator.click(bounds.centerX(), bounds.centerY())
  sleep(2000)

  taskLog('等待进入蚂蚁森林')
  widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', 5000)
  sleep(2000)
  taskLog('已在蚂蚁森林，等待5s后返回')
  sleep(5000)

  taskLog('返回神奇鱼塘')
  goBack()
  sleep(1000)
  goBack()
  sleep(1000)

  return true
}

function findAndExecuteTasks () {
  taskLog('通过控件查找任务按钮')

  try {
    let allNodes = className('android.widget.TextView').find()
    if (!allNodes || allNodes.size() === 0) {
      taskLog('未找到任何TextView控件')
      return false
    }

    // 第一遍遍历：记录所有任务描述文字的y值
    let browseY = -1, quizY = -1, forestY = -1
    for (let i = 0; i < allNodes.size(); i++) {
      try {
        let node = allNodes.get(i)
        let t = node.text() || node.desc()
        if (!t) continue
        let text = t.toString()
        let y = node.bounds().centerY()
        if (text.indexOf('点击1个商品进入详情页') >= 0) browseY = y
        else if (text.indexOf('参与绿色科普答题') >= 0) quizY = y
        else if (text.indexOf('去蚂蚁森林收更多能量') >= 0) forestY = y
      } catch (e) {}
    }
    // taskLog('任务位置 - 点击1个商品进入详情页: y=' + browseY + ', 参与绿色科普答题: y=' + quizY + ', 去蚂蚁森林收更多能量: y=' + forestY)

    // 第二遍遍历：匹配按钮文字，用记录的y值做同行判断
    for (let i = 0; i < allNodes.size(); i++) {
      try {
        let node = allNodes.get(i)
        let t = node.text() || node.desc()
        if (!t) continue
        let text = t.toString()
        let bounds = node.bounds()
        let y = bounds.centerY()

        if (y < config.device_height * 0.15) continue
        if (y > config.device_height * 0.85) continue

        if (text === '去浏览') {
          if (browseY >= 0 && Math.abs(y - browseY) < 200) {
            taskLog('找到"浏览商品"任务，当前控件y=' + y + '，描述y=' + browseY)
            doBrowseTask(bounds)
            return true
          }
        } else if (text === '去完成') {
          if (quizY >= 0 && Math.abs(y - quizY) < 200) {
            taskLog('找到"参与答题"任务，当前控件y=' + y + '，描述y=' + quizY)
            doQuizTask(bounds)
            return true
          } else if (forestY >= 0 && Math.abs(y - forestY) < 200) {
            taskLog('找到"蚂蚁森林"任务，当前控件y=' + y + '，描述y=' + forestY)
            doAntForestTask(bounds)
            return true
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    taskLog('TextView查找任务异常: ' + e)
  }

  taskLog('未找到可执行的任务按钮')
  return false
}

/**
 * 执行鱼塘主页面任务：OCR识别"森林回访"、"线上逛街"并点击（只识别屏幕上半部）
 */
function doMainPageTasks () {
  taskLog('执行鱼塘主页面任务')
  if (!localOcrUtil.enabled) return

  let targets = ['森林回访', '线上逛街']
  let region = [0, 0, config.device_width, parseInt(config.device_height * 0.5)]

  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) return

  for (let t = 0; t < targets.length; t++) {
    let results = localOcrUtil.recognizeWithBounds(screen, region, targets[t])
    if (results && results.length > 0) {
      let match = results[0]
      taskLog('OCR找到"' + targets[t] + '": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
      automator.click(match.bounds.centerX(), match.bounds.centerY())
      sleep(2000)
    } else {
      taskLog('未找到"' + targets[t] + '"')
    }
  }

  screen.recycle()
}


/**
 * 通过OCR识别任务按钮，匹配同行文字后执行
 */
function findAndExecuteTasksOcr () {
  taskLog('通过OCR查找任务按钮')

  if (!localOcrUtil.enabled) {
    taskLog('OCR不可用')
    return false
  }

  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) {
    taskLog('截图失败')
    return false
  }

  let allResults = localOcrUtil.recognizeWithBounds(screen, [0, 0, config.device_width, config.device_height], '')
  screen.recycle()
  if (!allResults || allResults.length === 0) {
    taskLog('OCR未识别到任何文字')
    return false
  }

  // 第一遍遍历：记录所有任务描述文字的y值
  let browseY = -1, quizY = -1, forestY = -1
  for (let i = 0; i < allResults.length; i++) {
    let text = allResults[i].label
    let y = allResults[i].bounds.centerY()
    if (text.indexOf('点击1个商品进入') >= 0) browseY = y
    else if (text.indexOf('参与绿色科普答题') >= 0) quizY = y
    else if (text.indexOf('去蚂蚁森林收更多能量') >= 0) forestY = y
  }
  // taskLog('OCR任务位置 - 点击1个商品进入详情页: y=' + browseY + ', 参与绿色科普答题: y=' + quizY + ', 去蚂蚁森林收更多能量: y=' + forestY)

  // 第二遍遍历：匹配按钮文字，用记录的y值做同行判断
  for (let i = 0; i < allResults.length; i++) {
    let match = allResults[i]
    let text = match.label
    let y = match.bounds.centerY()

    if (y < config.device_height * 0.15) continue
    if (y > config.device_height * 0.85) continue

    if (text === '去浏览') {
      if (browseY >= 0 && Math.abs(y - browseY) < 200) {
        taskLog('OCR找到"浏览商品"任务，当前控件y=' + y + '，描述y=' + browseY)
        doBrowseTask(match.bounds)
        return true
      }
    } else if (text === '去完成') {
      if (quizY >= 0 && Math.abs(y - quizY) < 200) {
        taskLog('OCR找到"参与答题"任务，当前控件y=' + y + '，描述y=' + quizY)
        doQuizTask(match.bounds)
        return true
      } else if (forestY >= 0 && Math.abs(y - forestY) < 200) {
        taskLog('OCR找到"蚂蚁森林"任务，当前控件y=' + y + '，描述y=' + forestY)
        doAntForestTask(match.bounds)
        return true
      }
    }
  }

  taskLog('OCR未找到可执行的任务按钮')
  return false
}
// ============ 主流程 ============

function main () {
  infoLog('神奇鱼塘脚本启动', true)

  threads.start(function () {
    events.observeKey()
    events.on("key_down", function (keyCode, event) {
      if (keyCode === 24) {
        toastLog('用户按音量上键，退出脚本')
        killApps()
        sleep(500)
        exit()
      }
    })
  })

  taskLog('=== 步骤1: 打开神奇鱼塘 ===')
  if (!openFishPool()) {
    errorInfo('打开神奇鱼塘失败')
    commonFunction.minimize()
    sleep(500)
    // 杀掉后台进程
    killApps()
    sleep(500)
    runningQueueDispatcher.removeRunningTask()
    exit()
  }

  taskLog('=== 步骤2: 点击"得能量" ===')
  if (!clickGetEnergy()) {
    errorInfo('无法找到"得能量"入口')
    commonFunction.minimize()
    sleep(500)
    // 杀掉后台进程
    killApps()
    sleep(500)
    runningQueueDispatcher.removeRunningTask()
    exit()
  }

  taskLog('=== 步骤3: 等待任务页面 ===')
  if (!waitForTaskPage()) {
    errorInfo('任务页面加载失败')
    commonFunction.minimize()
    sleep(500)
    // 杀掉后台进程
    killApps()
    sleep(500)
    runningQueueDispatcher.removeRunningTask()
    exit()
  }

  taskLog('=== 步骤4: 执行任务 ===')
  for (let round = 0; round < 2; round++) {
    taskLog('第 ' + (round + 1) + ' 轮执行')
    let tasksDone = 0
    while (findAndExecuteTasks()) {
      tasksDone++
      // 执行完一个任务后重新打开鱼塘进入得能量页面，确保下次查找时页面状态最新
      openFishPool()
      sleep(2000)
      clickGetEnergy()
      sleep(2000)
      waitForTaskPage()
    }
    // OCR版（备用，取消注释即可启用）
    // while (findAndExecuteTasksOcr()) {
    //   tasksDone++
    //   openFishPool()
    //   sleep(2000)
    //   clickGetEnergy()
    //   sleep(2000)
    //   waitForTaskPage()
    // }
    taskLog('本轮完成 ' + tasksDone + ' 个任务')
    sleep(1000)
  }

  taskLog('所有任务执行完毕')
  // 重新进入鱼塘，执行主页面任务后杀掉进程
  openFishPool()
  sleep(2000)
  doMainPageTasks()
  sleep(1000)
  commonFunction.minimize()
  sleep(500)
  // 杀掉后台进程
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
