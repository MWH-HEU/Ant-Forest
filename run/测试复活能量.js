/*
 * @Description: 调试脚本 - findColor找+5g橙色按钮并测试复活
 * 运行方式：在Auto.js中直接运行此脚本
 * 日志路径：../logs/find_controls.log
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let FileUtils = require('../lib/prototype/FileUtils.js')

// ============ 日志 ============
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/find_controls.log'
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

function logSep(title) {
  writeLog('')
  writeLog('========== ' + title + ' ==========')
  LogFloaty.pushLog(title)
}

// ============ 主流程 ============
function main() {
  LogFloaty.pushLog('调试脚本启动')
  writeLog('调试脚本启动')
  writeLog('设备分辨率: ' + config.device_width + 'x' + config.device_height)

  // 先进入蚂蚁森林
  LogFloaty.pushLog('正在进入蚂蚁森林...')
  writeLog('正在进入蚂蚁森林...')
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })
  sleep(5000)

  // 等待首页加载
  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }
  if (!widgetUtils.homePageWaiting()) {
    LogFloaty.pushLog('进入蚂蚁森林失败')
    writeLog('进入蚂蚁森林失败，继续执行...')
  } else {
    LogFloaty.pushLog('进入蚂蚁森林成功')
    writeLog('进入蚂蚁森林成功')
  }

  // 点击总能量榜
  logSep('点击总能量榜')
  let energyRank = widgetUtils.widgetGetById('rank-tab-energyRank', 2000)
  if (energyRank) {
    LogFloaty.pushLog('找到能量榜tab')
    writeLog('找到能量榜tab: ' + energyRank.bounds())
    energyRank.target.click()
    sleep(2000)
  } else {
    LogFloaty.pushLog('未找到能量榜tab，尝试点击文字')
    writeLog('未找到能量榜tab，尝试点击"总能量榜"文字')
    let rankTab = widgetUtils.widgetGetOne('.*(今日|本周|总)能量榜.*', 2000)
    if (rankTab) {
      LogFloaty.pushLog('找到能量榜文字')
      writeLog('找到能量榜文字: ' + rankTab.bounds())
      rankTab.click()
      sleep(2000)
    } else {
      LogFloaty.pushLog('未找到能量榜')
      writeLog('未找到能量榜')
    }
  }

  // 下滑进完整排行榜
  logSep('下滑进完整排行榜')
  let scrollLimit = 5
  while (scrollLimit-- > 0) {
    let moreFriends = widgetUtils.widgetGetOne(config.enter_friend_list_ui_content || '.*查看更多好友.*', 1000)
    if (moreFriends) {
      LogFloaty.pushLog('找到"查看更多好友"')
      writeLog('找到"查看更多好友": ' + moreFriends.bounds())
      moreFriends.click()
      sleep(2000)
      break
    }
    let h = config.device_height
    LogFloaty.pushLog('下滑第' + (5 - scrollLimit) + '次')
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
    sleep(1000)
  }

  sleep(2000)

  // ============ findColor找橙色按钮并复活 ============
  logSep('findColor找橙色+5g按钮并复活')
  try {
    let screen = commonFunction.captureScreen()
    let markers = []
    if (screen) {
      writeLog('截屏成功: ' + screen.getWidth() + 'x' + screen.getHeight())
      let color = '#FF8F00'
      let threshold = 50
      let w = config.device_width
      let region = [w * 0.9, 0, w * 0.1, config.device_height]
      writeLog('region: ' + JSON.stringify(region) + ' (右侧10%宽度)')
      let maxFind = 20
      let foundPoints = []
      while (maxFind-- > 0) {
        let point = images.findColor(screen, color, {
          region: region,
          threshold: threshold
        })
        if (!point) break
        foundPoints.push(point)
        writeLog('  找到 #' + foundPoints.length + ' (' + point.x + ', ' + point.y + ')')
        region = [w * 0.9, point.y + 30, w * 0.1, config.device_height - (point.y + 30)]
        if (region[3] <= 0) break
      }
      writeLog('共找到 ' + foundPoints.length + ' 个橙色点')
      // 去重合并成对点
      foundPoints.forEach(p => {
        let isDuplicate = markers.some(m => Math.abs(m.centerY - (p.y + 15)) < 40)
        if (!isDuplicate) {
          markers.push({
            centerX: p.x + 20,
            centerY: p.y + 15
          })
        }
      })
      writeLog('合并后 ' + markers.length + ' 个+5g按钮')
      markers.sort((a, b) => a.centerY - b.centerY)
      markers.forEach((m, idx) => {
        writeLog('  [' + idx + '] center=(' + m.centerX + ', ' + m.centerY + ')')
      })
    } else {
      writeLog('截屏失败')
    }

    // 依次点击每个按钮，尝试复活
    logSep('依次点击+5g按钮复活')
    if (markers.length > 0) {
      markers.sort((a, b) => a.centerY - b.centerY)
      for (let idx = 0; idx < markers.length; idx++) {
        let m = markers[idx]
        LogFloaty.pushLog('点击第' + (idx + 1) + '个+5g: (' + m.centerX + ',' + m.centerY + ')')
        writeLog('点击第' + (idx + 1) + '个+5g: (' + m.centerX + ',' + m.centerY + ')')
        automator.click(m.centerX, m.centerY)
        sleep(2000)

        // 查找"帮TA复活能量"
        let reviveBtn = widgetUtils.widgetGetOne('帮TA复活能量|帮好友复活能量', 2000)
        if (reviveBtn) {
          writeLog('  找到"帮TA复活能量"，点击')
          reviveBtn.click()
          sleep(1500)

          // 查找"确认发送"
          let confirmBtn = widgetUtils.widgetGetOne('确认发送', 2000)
          if (confirmBtn) {
            writeLog('  找到"确认发送"，点击')
            confirmBtn.click()
            sleep(1500)
            writeLog('  复活成功！')
          } else {
            writeLog('  未找到"确认发送"')
          }
        } else {
          writeLog('  未找到"帮TA复活能量"')
        }

        // 返回
        back()
        sleep(1500)
      }
      LogFloaty.pushLog('复活测试完成')
    } else {
      writeLog('没有按钮可点击')
    }
  } catch (e) {
    writeLog('异常: ' + e)
  }

  LogFloaty.pushLog('调试结束')
  writeLog('')
  writeLog('========== 调试结束 ==========')
  writeLog('日志文件: ' + _logFilePath)
  toastLog('调试完成，日志已保存到: ' + _logFilePath)
}

main()
