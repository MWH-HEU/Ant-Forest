/*
 * 自动执行每日任务
 * 1. 打开蚂蚁森林 → 点击"领奖励"
 * 2. 进入领奖励页面
 * 3. 控件优先/OCR兜底识别"立即领取"和"去抽奖"按钮，处理领取/抽奖流程
 * 4. 控件查找"逛一逛"、"去看看"、"去参与"、"去领取"、"去守护"、"去完成"探索任务
 *    （排除"玩一场能量雨"、"添加1份看病保障"、"去淘宝看科普视频"、"去蚂蚁阿福健康问答"、"添加小荷包能量插件"）
 *    特殊处理："每日浇水领真绿植"进入后下滑上滑8次；"逛惊喜市集领红包"进入后等待15s再下滑上滑15次
 * 5. 点击前检查附近是否有"玩一玩"、"获取更多森林资讯"、"看15s直播得能量"或"逛一逛飞猪"，有则等待15秒，否则2秒
 * 6. 点击后处理弹窗（"支付宝想要打开xxx"等）
 * 7. kill支付宝、淘宝、美团、闲鱼、一淘、飞猪、高德、点淘、百度极速版进程重新打开领奖励页面
 * 8. 没有匹配到内容时退出（最多40轮）
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
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let FileUtils = require('../lib/prototype/FileUtils.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' },
      { pkg: 'com.taobao.taobao', name: '淘宝' },
      { pkg: 'com.sankuai.meituan', name: '美团' },
      { pkg: 'com.taobao.idlefish', name: '闲鱼' },
      { pkg: 'com.taobao.etao', name: '一淘' },
      { pkg: 'com.taobao.trip', name: '飞猪' },
      { pkg: 'com.autonavi.minimap', name: '高德地图' },
      { pkg: 'com.taobao.live', name: '点淘' },
      { pkg: 'com.baidu.searchbox.lite', name: '百度极速版' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

runningQueueDispatcher.addRunningTask()

// 调试日志（仅悬浮窗显示，不写入文件）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  commonFunction.minimize()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

// ============ 工具函数 ============

function openAntForest () {
  taskLog('正在打开蚂蚁森林')
  commonFunction.backHomeIfInVideoPackage()
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  sleep(1000)
  widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', 3000)
  sleep(3000)
  taskLog('蚂蚁森林已打开')
}

function waitAndClick (text, timeout) {
  timeout = timeout || 3000
  let btn = widgetUtils.widgetGetOne(text, timeout)
  if (btn) {
    taskLog('点击: ' + text)
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }
  return false
}

function goBack () {
  back()
  sleep(800)
}

function getText (node) {
  try {
    let t = node.text()
    return t ? t.toString() : ''
  } catch (e) {
    return ''
  }
}

/**
 * 通过OCR识别"领奖励"入口并点击
 */
function clickClaimRewardByOcr () {
  taskLog('通过OCR识别查找领奖励入口')
  
  if (!localOcrUtil.enabled) {
    taskLog('OCR未启用，尝试通过控件查找')
    return clickClaimRewardByWidget()
  }
  
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) {
    errorInfo('截图失败')
    return false
  }
  
  // 领奖励在屏幕下半部分
  let region = [0, parseInt(config.device_height * 0.5), config.device_width, parseInt(config.device_height * 0.4)]
  let results = localOcrUtil.recognizeWithBounds(screen, region, '领奖励')
  screen.recycle()
  
  if (results && results.length > 0) {
    let match = results[0]
    let bounds = match.bounds
    let clickX = bounds.centerX()
    let clickY = bounds.top - 60
    taskLog('OCR找到领奖励: "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
    automator.click(clickX, clickY)
    sleep(2000)
    return true
  } else {
    taskLog('OCR未识别到领奖励文字')
    return false
  }
}

/**
 * 通过控件查找领奖励入口
 */
function clickClaimRewardByWidget () {
  taskLog('遍历控件查找领奖励入口')
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('领奖励') >= 0) {
            let bounds = tv.bounds()
            let clickX = bounds.centerX()
            let clickY = bounds.top - 60
            taskLog('找到领奖励文字控件，点击: (' + clickX + ', ' + clickY + ')')
            automator.click(clickX, clickY)
            sleep(2000)
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('遍历控件异常: ' + e)
  }

  // 通过"背包"推算
  taskLog('尝试通过背包推算领奖励位置')
  let neighbor = widgetUtils.widgetGetOne('背包', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let rewardX = bounds.left + iconWidth + 10
    let rewardY = bounds.centerY()
    taskLog('通过背包推算领奖励: (' + rewardX + ', ' + rewardY + ')')
    automator.click(rewardX, rewardY)
    sleep(2000)
    return true
  }

  // 通过"乐园"推算
  neighbor = widgetUtils.widgetGetOne('乐园', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let rewardX = bounds.left + iconWidth * 2 + 20
    let rewardY = bounds.centerY()
    taskLog('通过乐园推算领奖励: (' + rewardX + ', ' + rewardY + ')')
    automator.click(rewardX, rewardY)
    sleep(2000)
    return true
  }

  return false
}






/**
 * 控件优先/OCR兜底识别并点击"立即领取"
 * 点击后：
 * - 有"立即抽奖"弹窗 → 走抽奖流程
 * - 无弹窗 → 纯领取已完成
 * 每轮最多执行2次
 */
function tryClickClaim () {
  // 优先控件查找"立即领取"
  taskLog('通过控件查找"立即领取"按钮')
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text()
          if (t && t.toString().indexOf('立即领取') >= 0) {
            let bounds = node.bounds()
            taskLog('控件找到"立即领取": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            
            // 检查是否有"立即抽奖"弹窗
            if (clickImmediateLottery()) {
              sleep(2000)
              clickCollectReward()
            } else {
              taskLog('立即领取完成（纯领取，无弹窗）')
            }
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找"立即领取"异常: ' + e)
  }
  
  // 控件没找到，尝试OCR兜底
  if (localOcrUtil.enabled) {
    taskLog('控件未找到，尝试OCR识别"立即领取"')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, 0, config.device_width, config.device_height]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '立即领取')
      screen.recycle()
      
      if (results && results.length > 0) {
        for (let r = 0; r < results.length; r++) {
          let match = results[r]
          let label = match.label
          if (label.indexOf('立即领取') >= 0) {
            let bounds = match.bounds
            taskLog('OCR找到"立即领取": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            
            if (clickImmediateLottery()) {
              sleep(2000)
              clickCollectReward()
            } else {
              taskLog('立即领取完成（纯领取，无弹窗）')
            }
            return true
          }
        }
      }
    }
  }
  
  return false
}

/**
 * 控件优先/OCR兜底识别并点击"去抽奖"
 * 跳过上方森林寻宝区域（y<0.35*高度）
 * 点击后进入抽奖页面，最多3次点击"立即抽奖"，再点"收下奖励"
 * 每轮最多执行2次
 */
function tryClickGoLottery () {
  // 优先控件查找"去抽奖"
  taskLog('通过控件查找"去抽奖"按钮')
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text()
          if (t && t.toString().indexOf('去抽奖') >= 0) {
            let bounds = node.bounds()
            // 跳过屏幕上半部分的"去抽奖"（森林寻宝区域），只处理下半部分任务列表的
            if (bounds.centerY() < config.device_height * 0.35) {
              taskLog('跳过上方森林寻宝区域的"去抽奖": y=' + bounds.centerY())
              continue
            }
            taskLog('控件找到"去抽奖": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(3000)
            
            taskLog('等待抽奖页面加载，点击"立即抽奖"')
            for (let retry = 0; retry < 3; retry++) {
              if (clickImmediateLottery()) {
                sleep(2000)
                clickCollectReward()
                break
              }
              taskLog('第' + (retry + 1) + '次点击"立即抽奖"失败，重试...')
              sleep(2000)
            }
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找"去抽奖"异常: ' + e)
  }
  
  // 控件没找到，尝试OCR兜底
  if (localOcrUtil.enabled) {
    taskLog('控件未找到，尝试OCR识别"去抽奖"')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, 0, config.device_width, config.device_height]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '去抽奖')
      screen.recycle()
      
      if (results && results.length > 0) {
        for (let r = 0; r < results.length; r++) {
          let match = results[r]
          let label = match.label
          if (label.indexOf('去抽奖') >= 0) {
            let bounds = match.bounds
            if (bounds.centerY() < config.device_height * 0.35) {
              taskLog('跳过上方森林寻宝区域的"去抽奖": y=' + bounds.centerY())
              continue
            }
            taskLog('OCR找到"去抽奖": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(3000)
            
            taskLog('等待抽奖页面加载，点击"立即抽奖"')
            for (let retry = 0; retry < 3; retry++) {
              if (clickImmediateLottery()) {
                sleep(2000)
                clickCollectReward()
                break
              }
              taskLog('第' + (retry + 1) + '次点击"立即抽奖"失败，重试...')
              sleep(2000)
            }
            return true
          }
        }
      }
    }
  }
  
  return false
}

/**
 * 点击"立即抽奖"按钮
 */
function clickImmediateLottery () {
  taskLog('查找"立即抽奖"按钮')
  
  // 等待页面加载
  sleep(2000)
  
  // 先通过控件查找
  if (waitAndClick('.*立即抽奖.*', 3000)) {
    sleep(1500)
    return true
  }
  
  // 通过OCR查找（全屏搜索）
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      taskLog('OCR区域: 全屏, 搜索: 立即抽奖')
  // writeLog('OCR区域: 全屏, 搜索: 立即抽奖')
      let results = localOcrUtil.recognizeWithBounds(screen, [0, 0, config.device_width, config.device_height], '立即抽奖')
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"立即抽奖": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(1500)
        return true
      }
    }
  }
  return false
}

/**
 * 点击"收下奖励"按钮
 */
function clickCollectReward () {
  taskLog('查找"收下奖励"按钮')
  
  // 先通过控件查找
  if (waitAndClick('.*收下奖励.*', 3000)) {
    sleep(1500)
    return true
  }
  
  // 通过OCR查找
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, [0, parseInt(config.device_height * 0.4), config.device_width, parseInt(config.device_height * 0.5)], '收下奖励')
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"收下奖励": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(1500)
        return true
      }
    }
  }
  return false
}

/**
 * 控件查找并点击探索任务按钮
 * 关键词：逛一逛、去看看、去参与、去领取、去守护、去完成
 * 排除：玩一场能量雨、添加1份看病保障、去淘宝看科普视频、去蚂蚁阿福健康问答、添加小荷包能量插件（检查按钮附近是否有排除文字）
 * 点击前检查附近是否有"玩一玩"、"获取更多森林资讯"、"看15s直播得能量"或"逛一逛飞猪"，有则等待15秒（逛一逛飞猪等待25秒），否则2秒
 * 点击后处理弹窗
 * 返回是否找到了并点击了
 */
function findAndClickExploreTask () {
  // 优先通过控件查找（同时查找 text 和 desc）
  taskLog('通过控件查找探索任务按钮')
  try {
    // 先查找所有控件（不限定 TextView）
    let allNodes = className('android.widget.Button').find()
    if (!allNodes || allNodes.size() === 0) {
      allNodes = className('android.view.View').find()
    }
    if (allNodes) {
      // taskLog('控件总数: ' + allNodes.size())
      // 打印前30个控件的文字和desc用于调试
      let debugTexts = ''
      for (let d = 0; d < Math.min(allNodes.size(), 30); d++) {
        try {
          let node = allNodes.get(d)
          let dt = node.text() || node.desc()
          if (dt) debugTexts += dt.toString() + '|'
        } catch (e) {}
      }
      // taskLog('控件文字/desc(前30): ' + debugTexts)
      // writeLog('控件文字/desc(前30): ' + debugTexts)
    }
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text() || node.desc()
          if (t) {
            let text = t.toString()
            // 记录所有匹配到的内容
            // 匹配控件调试信息（已注释）
            // if (text.indexOf('逛') >= 0 || text.indexOf('看') >= 0 || ...) { ... }
            if (text.indexOf('逛一逛') >= 0 || text.indexOf('去看看') >= 0 || 
                text.indexOf('去参与') >= 0 || text.indexOf('去领取') >= 0 ||
                text.indexOf('去守护') >= 0 || text.indexOf('去完成') >= 0) {
              // 检查该按钮所在行附近是否有需要跳过的任务
              let shouldSkip = false
              let skipReasons = ['玩一场能量雨', '添加1份看病保障', '去淘宝看科普视频', '去蚂蚁阿福健康问答', '添加小荷包能量插件']
              try {
                let myBounds = node.bounds()
                let allNodes2 = className('android.widget.Button').find()
                if (allNodes2) {
                  for (let n = 0; n < allNodes2.size(); n++) {
                    try {
                      let nt = allNodes2.get(n).text()
                      if (nt) {
                        let nText = nt.toString()
                        for (let s = 0; s < skipReasons.length; s++) {
                          if (nText.indexOf(skipReasons[s]) >= 0) {
                            let nb = allNodes2.get(n).bounds()
                            // 检查是否在同一行附近（y坐标相差小于200）
                            if (Math.abs(nb.centerY() - myBounds.centerY()) < 200) {
                              shouldSkip = true
                              taskLog('跳过"' + skipReasons[s] + '"行的按钮: "' + text + '"')
                              // writeLog('跳过"' + skipReasons[s] + '"行的按钮: "' + text + '"')
                              break
                            }
                          }
                        }
                        if (shouldSkip) break
                      }
                    } catch (e) {}
                  }
                }
              } catch (e) {}
              if (shouldSkip) continue
              let bounds = node.bounds()
              // 检查该行是否有特殊处理任务（逛一逛点淘得红包等）
              let specialTask = null
              let specialTasks = [
                { keyword: '逛一逛点淘得红包', waitTime: 15000, clickTarget: '点击领元宝', action: 'clickTarget' },
                { keyword: '每日浇水领真绿植', waitTime: 0, action: 'scroll8' },
                { keyword: '逛惊喜市集领红包', waitTime: 15000, action: 'scroll15' }
              ]
              try {
                let allNodes2 = className('android.widget.Button').find()
                if (allNodes2) {
                  for (let n = 0; n < allNodes2.size(); n++) {
                    try {
                      let nt = allNodes2.get(n).text()
                      if (nt) {
                        let nText = nt.toString()
                        for (let s = 0; s < specialTasks.length; s++) {
                          if (nText.indexOf(specialTasks[s].keyword) >= 0) {
                            let nb = allNodes2.get(n).bounds()
                            if (Math.abs(nb.centerY() - bounds.centerY()) < 200) {
                              specialTask = specialTasks[s]
                              taskLog('检测到"' + specialTask.keyword + '"行，走特殊处理')
                              break
                            }
                          }
                        }
                        if (specialTask) break
                      }
                    } catch (e) {}
                  }
                }
              } catch (e) {}
              // 在点击前检查附近是否有"玩一玩"、"获取更多森林资讯"、"看15s直播得能量"或"逛一逛飞猪"，有则等待15秒，否则2秒
              let waitTime = 2000
              let longWaitKeywords = ['玩一玩', '获取更多森林资讯', '看15s直播得能量', '逛一逛飞猪']
              try {
                let allNodes2 = className('android.widget.Button').find()
                if (allNodes2) {
                  for (let n = 0; n < allNodes2.size(); n++) {
                    try {
                      let nt = allNodes2.get(n).text()
                      if (nt) {
                        let nText = nt.toString()
                        for (let w = 0; w < longWaitKeywords.length; w++) {
                          if (nText.indexOf(longWaitKeywords[w]) >= 0) {
                            let nb = allNodes2.get(n).bounds()
                            if (Math.abs(nb.centerY() - bounds.centerY()) < 200) {
                              if (nText.indexOf('逛一逛飞猪') >= 0) {
                                waitTime = 25000
                                taskLog('附近有"' + nText + '"任务，等待25秒')
                              } else {
                                waitTime = 15000
                                taskLog('附近有"' + nText + '"任务，等待15秒')
                              }
                              break
                            }
                          }
                        }
                        if (waitTime > 2000) break
                      }
                    } catch (e) {}
                  }
                }
              } catch (e) {}
              if (waitTime === 2000) {
                taskLog('附近无长等待任务，等待2秒')
              }
              taskLog('控件找到探索任务: "' + text + '" 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
              automator.click(bounds.centerX(), bounds.centerY())
              sleep(2000)
              handlePopupDialog()
              // 特殊处理：根据特殊任务类型执行额外操作
              if (specialTask) {
                taskLog('执行特殊任务: ' + specialTask.keyword + '，等待' + specialTask.waitTime + '毫秒')
                sleep(2000)
                if (specialTask.action === 'clickTarget' && specialTask.clickTarget) {
                  try {
                    // 同时查找 Button 和 TextView
                    let found = false
                    let allButtons = className('android.widget.Button').find()
                    let allTextViews = className('android.widget.TextView').find()
                    let allNodes3 = []
                    if (allButtons) {
                      for (let bi = 0; bi < allButtons.size(); bi++) allNodes3.push(allButtons.get(bi))
                    }
                    if (allTextViews) {
                      for (let ti = 0; ti < allTextViews.size(); ti++) allNodes3.push(allTextViews.get(ti))
                    }
                    for (let n = 0; n < allNodes3.length; n++) {
                      try {
                        let nt = allNodes3[n].text()
                        if (nt && nt.toString().indexOf(specialTask.clickTarget) >= 0) {
                          let nb = allNodes3[n].bounds()
                          taskLog('找到"' + specialTask.clickTarget + '": 点击: (' + nb.centerX() + ', ' + nb.centerY() + ')')
                          automator.click(nb.centerX(), nb.centerY())
                          found = true
                          break
                        }
                      } catch (e) {}
                    }
                    if (!found) {
                      taskLog('控件未找到"' + specialTask.clickTarget + '"，尝试OCR')
                      if (localOcrUtil.enabled) {
                        commonFunction.requestScreenCaptureOrRestart()
                        sleep(500)
                        let screen = commonFunction.captureScreen()
                        if (screen) {
                          let results = localOcrUtil.recognizeWithBounds(screen, [0, 0, config.device_width, config.device_height], specialTask.clickTarget)
                          screen.recycle()
                          if (results && results.length > 0) {
                            let match = results[0]
                            taskLog('OCR找到"' + specialTask.clickTarget + '": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
                            automator.click(match.bounds.centerX(), match.bounds.centerY())
                          }
                        }
                      }
                    }
                  } catch (e) {
                    taskLog('查找' + specialTask.clickTarget + '异常: ' + e)
                  }
                } else if (specialTask.action === 'scroll8') {
                  // 每日浇水领真绿植：先检查弹窗
                  taskLog('执行' + specialTask.keyword + '，检查弹窗')
                  // 每隔2s检查"去逛逛"，最多7次
                  for (let i = 0; i < 7; i++) {
                    sleep(2000)
                    let btn = widgetUtils.widgetGetOne('去逛逛', 1000)
                    if (btn) {
                      taskLog('找到"去逛逛"，点击')
                      automator.clickCenter(btn)
                      sleep(1000)
                      break
                    }
                  }
                  // 每隔2s检查"立即使用"，最多2次
                  for (let i = 0; i < 2; i++) {
                    sleep(2000)
                    let btn = widgetUtils.widgetGetOne('立即使用', 1000)
                    if (btn) {
                      taskLog('找到"立即使用"，点击')
                      automator.clickCenter(btn)
                      sleep(1000)
                      break
                    }
                  }
                  // 执行滑动操作
                  taskLog('执行' + specialTask.keyword + '，下滑上滑15次')
                  let scrollRound = 15
                  while (scrollRound-- > 0) {
                    let h = config.device_height
                    automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
                    sleep(500)
                    automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
                    sleep(500)
                    sleep(500)
                  }
                } else if (specialTask.action === 'scroll15') {
                  let scrollRound = 15
                  taskLog('执行' + specialTask.keyword + '，下滑上滑' + scrollRound + '次')
                  while (scrollRound-- > 0) {
                    let h = config.device_height
                    automator.randomScrollDown(0.7 * h, 0.8 * h, 0.2 * h, 0.3 * h)
                    sleep(500)
                    automator.randomScrollUp(0.2 * h, 0.3 * h, 0.7 * h, 0.8 * h)
                    sleep(500)
                    sleep(500)
                  }
                }
                waitTime = specialTask.waitTime
              }
              sleep(waitTime)
              return true
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找探索任务异常: ' + e)
  }
  
  // OCR兜底（已注释，探索任务全部通过控件查找）
  /*
  if (localOcrUtil.enabled) {
    taskLog('控件未找到，尝试OCR识别探索任务按钮')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, 0, config.device_width, config.device_height]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '逛一逛|去看看|去参与|去领取|去守护|去完成')
      screen.recycle()
      if (results && results.length > 0) {
        let allTexts = ''
        for (let r = 0; r < results.length; r++) {
          allTexts += results[r].label + '|'
        }
        taskLog('OCR探索任务识别结果: ' + allTexts)
        for (let r = 0; r < results.length; r++) {
          let match = results[r]
          let label = match.label
          let bounds = match.bounds
          let isTarget = false
          if (label.indexOf('逛一逛') >= 0) isTarget = true
          else if (label.indexOf('去看看') >= 0) isTarget = true
          else if (label.indexOf('去参与') >= 0) isTarget = true
          else if (label.indexOf('去领取') >= 0) isTarget = true
          else if (label.indexOf('去守护') >= 0) isTarget = true
          else if (label.indexOf('去完成') >= 0) isTarget = true
          if (!isTarget) continue
          // 用控件确认附近是否有排除关键词
          if (label.indexOf('去完成') >= 0) {
            try {
              let allNodes2 = className('android.widget.Button').find()
              if (allNodes2) {
                for (let n = 0; n < allNodes2.size(); n++) {
                  try {
                    let nt = allNodes2.get(n).text()
                    if (nt) {
                      let nText = nt.toString()
                      if (nText.indexOf('添加1份看病保障') >= 0 || nText.indexOf('玩一场能量雨') >= 0 || nText.indexOf('去淘宝看科普视频') >= 0 || nText.indexOf('去蚂蚁阿福健康问答') >= 0 || nText.indexOf('添加小荷包能量插件') >= 0) {
                        let nb = allNodes2.get(n).bounds()
                        if (Math.abs(nb.centerY() - bounds.centerY()) < 200) {
                          taskLog('OCR跳过"' + nText + '"行的"去完成"')
                          isExcluded = true
                          break
                        }
                      }
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
            if (isExcluded) continue
          }
          taskLog('OCR找到探索任务: "' + label + '" 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
          automator.click(bounds.centerX(), bounds.centerY())
          sleep(2000)
          handlePopupDialog()
          return true
        }
      }
    }
  }
  */
  
  taskLog('未找到探索任务按钮')
  return false
}

/**
 * 处理弹窗：检测"支付宝想要打开xxx"等并点击"打开"
 */
function handlePopupDialog () {
  taskLog('检查是否有弹窗')
  
  // 等待弹窗动画完成
  sleep(500)
  
  // 查找"打开"按钮（系统弹窗）
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(1500)
    return true
  }
  
  // 通过文字"支付宝"+"打开"判断
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      let hasAlipayText = false
      let hasOpenButton = false
      let openButton = null
      
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t) {
            let text = t.toString()
            if (text.indexOf('支付宝') >= 0 && text.indexOf('打开') >= 0) {
              hasAlipayText = true
            }
            if (text === '打开') {
              hasOpenButton = true
              openButton = tv
            }
          }
        } catch (e) {}
      }
      
      if (hasAlipayText && hasOpenButton && openButton) {
        taskLog('检测到"支付宝想要打开xxx"弹窗，点击"打开"')
        automator.clickCenter(openButton)
        sleep(1500)
        return true
      }
    }
  } catch (e) {
    taskLog('检查弹窗异常: ' + e)
  }
  
  taskLog('未检测到弹窗')
  return false
}

/**
 * 返回桌面并重新打开领奖励页面
 * 先 kill 支付宝、淘宝、美团、闲鱼、一淘、飞猪、高德、点淘、百度极速版进程再重启，确保清除所有打开的页面
 */
function reopenRewardPage () {
  taskLog('返回桌面并重新打开领奖励页面')
  
  // 返回桌面
  commonFunction.minimize()
  sleep(1000)
  
  // 重新打开蚂蚁森林
  openAntForest()
  
  // 点击领奖励
  taskLog('重新点击领奖励')
  if (!clickClaimRewardByOcr()) {
    taskLog('重新点击领奖励失败，尝试控件方式')
    clickClaimRewardByWidget()
  }
  sleep(3000)
}

// ============ 主流程 ============

// 全局日志文件
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/renwu.log'
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

function main () {
  // 初始化日志
  // writeLog('===== 每日任务脚本启动 =====')
  // 音量上键退出脚本（在独立线程中轮询检测）
  infoLog('运行中可按音量上键关闭', true)
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
  
  // 1. 打开蚂蚁森林
  openAntForest()

  // 2. 点击"领奖励"
  taskLog('查找领奖励入口')
  if (!clickClaimRewardByOcr()) {
    errorInfo('无法定位领奖励入口')
    commonFunction.minimize()
    sleep(500)
    killApps()
    runningQueueDispatcher.removeRunningTask()
    exit()
  }
  sleep(3000)
  


  // 4. 主循环
  let maxRounds = 40
  for (let round = 0; round < maxRounds; round++) {
    taskLog('=== 每日任务 第 ' + (round + 1) + ' 轮 ===')
    // writeLog('=== 第 ' + (round + 1) + ' 轮开始 ===')
    
    // 每轮中领取最多执行2次
    for (let c = 0; c < 2; c++) {
      try {
        if (!tryClickClaim()) break
        // writeLog('第' + (round + 1) + '轮: 点击领取成功(第' + (c + 1) + '次)')
      } catch (e) {
        let errMsg = e && e.message ? e.message : e
        // writeLog('第' + (round + 1) + '轮: 点击领取异常 - ' + errMsg)
        errorInfo('点击领取异常: ' + errMsg)
      }
    }
    
    // 每轮中去抽奖最多执行2次
    for (let l = 0; l < 2; l++) {
      try {
        if (!tryClickGoLottery()) break
        // writeLog('第' + (round + 1) + '轮: 去抽奖成功(第' + (l + 1) + '次)')
      } catch (e) {
        let errMsg = e && e.message ? e.message : e
        // writeLog('第' + (round + 1) + '轮: 去抽奖异常 - ' + errMsg)
        errorInfo('去抽奖异常: ' + errMsg)
      }
    }
    
    // 执行探索任务
    taskLog('尝试探索任务')
    // writeLog('第' + (round + 1) + '轮: 尝试探索任务')
    
    try {
      if (findAndClickExploreTask()) {
        taskLog('点击了探索任务，等待后重新打开领奖励页面')
        // writeLog('第' + (round + 1) + '轮: 点击探索任务成功')
        
        // 重新打开领奖励页面
        // writeLog('第' + (round + 1) + '轮: 重新打开领奖励页面')
        reopenRewardPage()
        // writeLog('第' + (round + 1) + '轮: 重新打开完毕')
        continue
      }
    } catch (e) {
      let errMsg = e && e.message ? e.message : e
      // writeLog('第' + (round + 1) + '轮: 探索任务异常 - ' + errMsg)
      errorInfo('探索任务异常: ' + errMsg)
      // 异常后也尝试重新打开
      try {
        reopenRewardPage()
      } catch (e2) {}
      // 异常后继续下一轮（可能是截图问题，重试一次）
      continue
    }
    
    // 没有匹配到任何内容，退出
    taskLog('没有更多任务可执行，退出每日任务')
    // writeLog('第' + (round + 1) + '轮: 没有更多任务，退出')
    break
  }

  // 返回原页面
  taskLog('每日任务完成，返回原页面')
  commonFunction.minimize()
  sleep(500)
  // 杀掉后台进程
  killApps()
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
