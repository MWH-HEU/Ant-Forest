/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 测试森林寻宝页面检测
 * 进入森林寻宝页面，检测双Tab，在每个Tab执行一次大下滑，
 * 检测屏幕右侧的按钮，记录所有TextView的XY值和文字内容到日志文件。
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let FileUtils = sRequire('FileUtils')

runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// ============ 文件日志 ============
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/测试森林寻宝.log'
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

function taskLog(msg) {
  LogFloaty.pushLog(msg)
  writeLog(msg)
}

// ============ 工具函数 ============

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

function goBack() {
  back()
  sleep(800)
}

// ============ 进入森林寻宝页面 ============

function openForestHuntPage () {
  taskLog('正在打开蚂蚁森林')
  commonFunction.backHomeIfInVideoPackage()
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(confirm)
    sleep(1000)
  }
  widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', 3000)
  sleep(3000)
  taskLog('蚂蚁森林已打开')

  // 点击"领奖励"
  taskLog('查找领奖励入口')
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (screen) {
    let region = [0, parseInt(config.device_height * 0.5), config.device_width, parseInt(config.device_height * 0.4)]
    let results = localOcrUtil.recognizeWithBounds(screen, region, '领奖励')
    screen.recycle()
    if (results && results.length > 0) {
      let match = results[0]
      let clickX = match.bounds.centerX()
      let clickY = match.bounds.top - 60
      taskLog('OCR找到领奖励: "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
      automator.click(clickX, clickY)
      sleep(3000)
    }
  }

  // 点击"去抽奖"进入森林寻宝
  taskLog('查找森林寻宝区域的"去抽奖"')
  let found = false
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text()
          if (t && t.toString().indexOf('去抽奖') >= 0) {
            let bounds = node.bounds()
            if (bounds.centerY() < config.device_height * 0.35) {
              taskLog('找到森林寻宝"去抽奖"，点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
              automator.click(bounds.centerX(), bounds.centerY())
              sleep(3000)
              found = true
              break
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找"去抽奖"异常: ' + e)
  }

  if (!found && localOcrUtil.enabled) {
    taskLog('控件未找到，尝试OCR识别"去抽奖"')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen2 = commonFunction.captureScreen()
    if (screen2) {
      let region = [0, 0, config.device_width, parseInt(config.device_height * 0.35)]
      let results = localOcrUtil.recognizeWithBounds(screen2, region, '去抽奖')
      screen2.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"去抽奖": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(3000)
        found = true
      }
    }
  }

  if (!found) {
    taskLog('未找到森林寻宝"去抽奖"入口')
  } else {
    taskLog('已进入森林寻宝页面')
    sleep(2000)
  }
}

// ============ 检测双Tab ============

function checkHasEvent () {
  let appContainer = widgetUtils.widgetGetById('app')
  if (appContainer) {
    let subContainer = appContainer.child(0)
    if (subContainer) {
      try {
        let eventTabContainer = subContainer.child(1).child(0)
        if (eventTabContainer && eventTabContainer.childCount() > 1) {
          taskLog('检测到双Tab，Tab数量: ' + eventTabContainer.childCount())
          let tab0 = eventTabContainer.child(0)
          let tab1 = eventTabContainer.child(1)
          return [
            { bounds: tab0.bounds(), click: function() { tab0.click() } },
            { bounds: tab1.bounds(), click: function() { tab1.click() } }
          ]
        }
      } catch (e) {
        taskLog('checkHasEvent异常: ' + e)
      }
    }
  }
  return false
}

// ============ 检测按钮 ============

// 方法1: 控件查找Button + TextView（合并原方法1和方法2）
function detectButtonsByWidget () {
  taskLog('=== 方法1: 控件查找Button + TextView ===')
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个Button控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = node.bounds()
          taskLog('Button[' + i + ']: text="' + String(text) + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {
          taskLog('Button[' + i + '] 异常: ' + e)
        }
      }
    } else {
      taskLog('未找到Button控件')
    }
  } catch (e) {
    taskLog('控件查找Button异常: ' + e)
  }
  try {
    let allNodes = className('android.widget.TextView').find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个TextView控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = node.bounds()
          taskLog('TextView[' + i + ']: text="' + String(text) + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {
          taskLog('TextView[' + i + '] 异常: ' + e)
        }
      }
    } else {
      taskLog('未找到TextView控件')
    }
  } catch (e) {
    taskLog('控件查找TextView异常: ' + e)
  }
}

// 方法2: OCR识别所有文字（原方法3）
function detectButtonsByOcr (sharedScreen) {
  taskLog('=== 方法2: OCR识别所有文字 ===')
  if (!localOcrUtil.enabled) {
    taskLog('OCR未启用，跳过')
    return null
  }
  let screen = sharedScreen
  let needRecycle = false
  if (!screen) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    screen = commonFunction.captureScreen()
    needRecycle = true
  }
  if (!screen) {
    taskLog('截图失败')
    return null
  }
  let results = localOcrUtil.recognizeWithBounds(screen, null, null)
  if (needRecycle) {
    screen.recycle()
  }
  if (results && results.length > 0) {
    taskLog('OCR识别到 ' + results.length + ' 个文字区域')
    for (let i = 0; i < results.length; i++) {
      let match = results[i]
      let bounds = match.bounds
      taskLog('OCR[' + i + ']: text="' + match.label + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
    }
  } else {
    taskLog('OCR未识别到任何文字')
  }
  return screen
}

// 方法3: 查找所有控件（可点击 + 不可点击）
function detectClickableNodes () {
  taskLog('=== 方法3: 所有控件检测 ===')
  try {
    let allNodes = selector().find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let className = node.className()
          let clickable = false
          try { clickable = node.clickable() } catch (e) {}
          let bounds = node.bounds()
          taskLog('Node[' + i + ']: class=' + className + ' clickable=' + clickable + ' text="' + text + '" center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {}
      }
    } else {
      taskLog('未找到控件')
    }
  } catch (e) {
    taskLog('控件检测异常: ' + e)
  }
}

// 方法4: 颜色检测（参考测试复活能量.js）
function detectButtonsByColor (sharedScreen) {
  taskLog('=== 方法4: 颜色检测 ===')
  let screen = sharedScreen
  let needRecycle = false
  if (!screen) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    screen = commonFunction.captureScreen()
    needRecycle = true
  }
  if (!screen) {
    taskLog('截图失败，跳过颜色检测')
    return
  }
  
  let w = config.device_width
  let h = config.device_height
  taskLog('截屏成功: ' + screen.getWidth() + 'x' + screen.getHeight())
  
  // 检测绿色（去逛逛、去兑换等按钮常见色）
  let colorName = '绿色'
  let colorValue = '#00B578'
  let threshold = 50
  taskLog('--- 检测' + colorName + '(' + colorValue + ') 阈值:' + threshold + ' ---')
  
  let maxFind = 30
  let region = [0, 0, w, h]
  let foundPoints = []
  while (maxFind-- > 0) {
    let point = images.findColor(screen, colorValue, {
      region: region,
      threshold: threshold
    })
    if (!point) break
    foundPoints.push(point)
    region = [0, point.y + 10, w, h - (point.y + 10)]
    if (region[3] <= 0) break
  }
  
  // 去重合并（同一区域多个点合并为一个）
  let merged = []
  foundPoints.forEach(function (p) {
    let isDuplicate = merged.some(function (m) {
      return Math.abs(m.centerY - p.y) < 30 && Math.abs(m.centerX - p.x) < 30
    })
    if (!isDuplicate) {
      merged.push({ centerX: p.x, centerY: p.y })
    }
  })
  
  taskLog('  原始点: ' + foundPoints.length + ', 合并后: ' + merged.length)
  merged.forEach(function (m, idx) {
    taskLog('  [' + idx + '] center=(' + m.centerX + ', ' + m.centerY + ')')
  })
  
  if (needRecycle) {
    screen.recycle()
  }
}

// 获取控件文本（安全）
function getNodeText (node) {
  try {
    if (node.text) {
      let t = node.text()
      if (t) {
        return t.toString()
      }
    }
    if (node.desc) {
      let d = node.desc()
      if (d) {
        return d.toString()
      }
    }
    if (node.contentDescription) {
      let c = node.contentDescription()
      if (c) {
        return c.toString()
      }
    }
  } catch (e) {}
  return ''
}

// ============ 大下滑 ============

function bigScrollDown () {
  taskLog('执行大下滑')
  let h = config.device_height
  // 使用Automator的scrollDown方法
  automator.scrollDown()
  sleep(1500)
  automator.scrollDown()
  sleep(1500)
  taskLog('大下滑完成')
}

// ============ 检测Tab流程 ============

function analyzeTab (tabName) {
  taskLog('')
  taskLog('========================================')
  taskLog('开始分析 ' + tabName)
  taskLog('========================================')
  
  // 大下滑
  bigScrollDown()
  
  // 所有检测方法
  detectButtonsByWidget()
  detectClickableNodes()
  // OCR和颜色检测共用一次截图，减少截图冲突
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let sharedScreen = commonFunction.captureScreen()
  if (sharedScreen) {
    detectButtonsByOcr(sharedScreen)
    detectButtonsByColor(sharedScreen)
    sharedScreen.recycle()
  } else {
    taskLog('截图失败，跳过OCR和颜色检测')
    detectButtonsByOcr()
    detectButtonsByColor()
  }
  
  taskLog(tabName + ' 分析完成')
  taskLog('========================================')
  taskLog('')
}

// ============ 主流程 ============

function main () {
  taskLog('====== 测试森林寻宝 开始 ======')
  taskLog('设备分辨率: ' + config.device_width + 'x' + config.device_height)
  
  // 进入森林寻宝页面
  openForestHuntPage()
  
  // 检测双Tab
  let eventTabs = checkHasEvent()
  
  if (eventTabs && eventTabs.length > 1) {
    taskLog('检测到双Tab，共 ' + eventTabs.length + ' 个')
    
    // 分析Tab 0
    try {
      let b0 = eventTabs[0].bounds
      taskLog('Tab 0 bounds: (' + b0.left + ',' + b0.top + ',' + b0.right + ',' + b0.bottom + ')')
      eventTabs[0].click()
      taskLog('切换到Tab 0（默认界面）')
    } catch (e) {
      taskLog('切换Tab 0异常: ' + e)
    }
    sleep(1500)
    analyzeTab('Tab 0（默认界面）')
    
    // 分析Tab 1
    try {
      let b1 = eventTabs[1].bounds
      taskLog('Tab 1 bounds: (' + b1.left + ',' + b1.top + ',' + b1.right + ',' + b1.bottom + ')')
      eventTabs[1].click()
      taskLog('切换到Tab 1（活动界面）')
    } catch (e) {
      taskLog('切换Tab 1异常: ' + e)
    }
    sleep(1500)
    analyzeTab('Tab 1（活动界面）')
  } else {
    taskLog('未检测到双Tab，分析当前页面')
    analyzeTab('当前页面（单Tab）')
  }
  
  taskLog('')
  taskLog('====== 测试森林寻宝 结束 ======')
  
  // 退出
  sleep(2000)
  commonFunction.minimize()
  sleep(500)
  killApps()
  exit()
}

main()
