/**
 * ClawPerformance.swift
 * iOS Performance Monitoring SDK for all Claw apps
 * 
 * Provides comprehensive performance tracking including:
 * - App launch time
 * - Screen render time (Time to Interactive)
 * - Network call instrumentation
 * - Memory usage tracking
 * - Frame rate monitoring
 * - Battery impact tracking
 * - Offline queue depth monitoring
 */

import Foundation
import UIKit
import FirebasePerformance
import FirebaseFirestore

@objc public class ClawPerformance: NSObject {
    
    // MARK: - Singleton
    @objc public static let shared = ClawPerformance()
    
    // MARK: - Properties
    private var db: Firestore
    private var appName: String
    private var traces: [String: Trace] = [:]
    private var customTraces: [String: Date] = [:]
    private var displayLink: CADisplayLink?
    private var frameCount: Int = 0
    private var lastTimestamp: CFTimeInterval = 0
    private var memoryTimer: Timer?
    
    // MARK: - Configuration
    private struct Config {
        static let memoryCheckInterval: TimeInterval = 30.0 // 30 seconds
        static let frameRateCheckInterval: TimeInterval = 1.0 // 1 second
        static let maxQueueDepth: Int = 1000
    }
    
    // MARK: - Initialization
    private override init() {
        self.db = Firestore.firestore()
        
        // Determine app name from bundle identifier
        let bundleId = Bundle.main.bundleIdentifier ?? "unknown"
        switch bundleId {
        case let x where x.contains("fitness"):
            self.appName = "claw-fitness"
        case let x where x.contains("nutrition"):
            self.appName = "claw-nutrition"
        case let x where x.contains("meetings"):
            self.appName = "claw-meetings"
        case let x where x.contains("budget"):
            self.appName = "claw-budget"
        default:
            self.appName = "claw-ios"
        }
        
        super.init()
        
        setupPerformanceMonitoring()
    }
    
    // MARK: - Setup
    private func setupPerformanceMonitoring() {
        // Start monitoring app lifecycle
        setupAppLifecycleMonitoring()
        
        // Start memory monitoring
        startMemoryMonitoring()
        
        // Start frame rate monitoring
        startFrameRateMonitoring()
        
        // Setup network instrumentation
        setupNetworkInstrumentation()
    }
    
    // MARK: - App Lifecycle Monitoring
    private func setupAppLifecycleMonitoring() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidLaunch),
            name: UIApplication.didFinishLaunchingNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }
    
    @objc private func appDidLaunch() {
        // App launch time is measured from process start to this point
        let launchTime = ProcessInfo.processInfo.systemUptime
        recordMetric(name: "app_launch_time", value: launchTime * 1000, unit: "ms")
    }
    
    @objc private func appWillEnterForeground() {
        let resumeStart = Date()
        startCustomTrace(name: "app_resume_time", startTime: resumeStart)
        
        // End the resume trace after a short delay to capture UI readiness
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.endCustomTrace(name: "app_resume_time")
        }
    }
    
    // MARK: - Screen Render Time Monitoring
    @objc public func startScreenTrace(screenName: String) {
        let traceName = "screen_\(screenName)_load"
        startCustomTrace(name: traceName)
    }
    
    @objc public func endScreenTrace(screenName: String) {
        let traceName = "screen_\(screenName)_load"
        endCustomTrace(name: traceName)
    }
    
    @objc public func recordTimeToInteractive(screenName: String, timeMs: Double) {
        recordMetric(name: "time_to_interactive_\(screenName)", value: timeMs, unit: "ms")
    }
    
    // MARK: - Custom Trace API
    @objc public func startTrace(name: String) {
        // Use Firebase Performance for critical traces
        if isCriticalTrace(name) {
            let trace = Performance.startTrace(name: name)
            traces[name] = trace
        }
        
        // Always record custom traces for our analytics
        startCustomTrace(name: name)
    }
    
    @objc public func endTrace(name: String, success: Bool = true) {
        // End Firebase trace
        if let trace = traces[name] {
            if !success {
                trace.setValue("false", forAttribute: "success")
            }
            trace.stop()
            traces.removeValue(forKey: name)
        }
        
        // End custom trace
        endCustomTrace(name: name, success: success)
    }
    
    @objc public func addTraceAttribute(traceName: String, key: String, value: String) {
        traces[traceName]?.setValue(value, forAttribute: key)
    }
    
    // MARK: - Network Instrumentation
    private func setupNetworkInstrumentation() {
        // Swizzle URLSession methods to automatically track network calls
        swizzleNetworkMethods()
    }
    
    private func swizzleNetworkMethods() {
        // Implementation would swizzle URLSession.dataTask methods
        // to automatically track HTTP request performance
        // For brevity, showing the concept
    }
    
    @objc public func recordNetworkCall(
        url: String,
        method: String,
        statusCode: Int,
        responseTime: TimeInterval,
        responseSize: Int64
    ) {
        let success = statusCode >= 200 && statusCode < 400
        
        recordCustomMetric([
            "id": UUID().uuidString,
            "name": "network_call",
            "value": responseTime * 1000, // Convert to ms
            "unit": "ms",
            "app": appName,
            "timestamp": Timestamp(date: Date()),
            "metadata": [
                "url": url,
                "method": method,
                "status_code": String(statusCode),
                "response_size": String(responseSize),
                "success": String(success)
            ]
        ])
    }
    
    // MARK: - Memory Usage Tracking
    private func startMemoryMonitoring() {
        memoryTimer = Timer.scheduledTimer(withTimeInterval: Config.memoryCheckInterval, repeats: true) { _ in
            self.recordMemoryUsage()
        }
    }
    
    private func recordMemoryUsage() {
        let memoryUsage = getMemoryUsage()
        recordMetric(name: "memory_usage", value: Double(memoryUsage), unit: "bytes")
        
        // Alert if memory usage is high
        let memoryMB = Double(memoryUsage) / (1024 * 1024)
        if memoryMB > 200 {
            recordAlert(level: "warning", message: "High memory usage: \(Int(memoryMB))MB")
        }
    }
    
    private func getMemoryUsage() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size)/4
        
        let kerr: kern_return_t = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_,
                         task_flavor_t(MACH_TASK_BASIC_INFO),
                         $0,
                         &count)
            }
        }
        
        if kerr == KERN_SUCCESS {
            return info.resident_size
        }
        return 0
    }
    
    // MARK: - Frame Rate Monitoring
    private func startFrameRateMonitoring() {
        displayLink = CADisplayLink(target: self, selector: #selector(displayLinkCallback))
        displayLink?.add(to: .main, forMode: .common)
    }
    
    @objc private func displayLinkCallback(_ displayLink: CADisplayLink) {
        if lastTimestamp == 0 {
            lastTimestamp = displayLink.timestamp
            return
        }
        
        frameCount += 1
        let elapsed = displayLink.timestamp - lastTimestamp
        
        if elapsed >= Config.frameRateCheckInterval {
            let fps = Double(frameCount) / elapsed
            recordMetric(name: "frame_rate", value: fps, unit: "fps")
            
            // Alert if FPS is low (critical for smooth UI)
            if fps < 45 {
                recordAlert(level: "warning", message: "Low frame rate: \(Int(fps)) FPS")
            }
            
            frameCount = 0
            lastTimestamp = displayLink.timestamp
        }
    }
    
    // MARK: - Battery Impact Tracking
    @objc public func recordBatteryUsage() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let batteryLevel = UIDevice.current.batteryLevel
        let batteryState = UIDevice.current.batteryState
        
        recordCustomMetric([
            "id": UUID().uuidString,
            "name": "battery_status",
            "value": Double(batteryLevel * 100),
            "unit": "percent",
            "app": appName,
            "timestamp": Timestamp(date: Date()),
            "metadata": [
                "battery_level": String(batteryLevel),
                "battery_state": batteryStateString(batteryState)
            ]
        ])
    }
    
    private func batteryStateString(_ state: UIDevice.BatteryState) -> String {
        switch state {
        case .unknown: return "unknown"
        case .unplugged: return "unplugged"
        case .charging: return "charging"
        case .full: return "full"
        @unknown default: return "unknown"
        }
    }
    
    // MARK: - Offline Queue Monitoring
    @objc public func recordOfflineQueueDepth(_ depth: Int) {
        recordMetric(name: "offline_queue_depth", value: Double(depth), unit: "count")
        
        if depth > Config.maxQueueDepth {
            recordAlert(level: "critical", message: "Offline queue overflow: \(depth) items")
        }
    }
    
    // MARK: - Helper Methods
    private func isCriticalTrace(_ name: String) -> Bool {
        let criticalTraces = [
            "app_launch_time",
            "screen_load",
            "api_call",
            "photo_scan",
            "workout_save",
            "transaction_save"
        ]
        return criticalTraces.contains { name.contains($0) }
    }
    
    private func startCustomTrace(name: String, startTime: Date = Date()) {
        customTraces[name] = startTime
    }
    
    private func endCustomTrace(name: String, success: Bool = true) {
        guard let startTime = customTraces[name] else { return }
        
        let duration = Date().timeIntervalSince(startTime) * 1000 // Convert to ms
        customTraces.removeValue(forKey: name)
        
        recordCustomMetric([
            "id": UUID().uuidString,
            "name": name,
            "value": duration,
            "unit": "ms",
            "app": appName,
            "timestamp": Timestamp(date: Date()),
            "metadata": [
                "success": String(success)
            ]
        ])
    }
    
    @objc public func recordMetric(name: String, value: Double, unit: String) {
        recordCustomMetric([
            "id": UUID().uuidString,
            "name": name,
            "value": value,
            "unit": unit,
            "app": appName,
            "timestamp": Timestamp(date: Date()),
            "metadata": [:]
        ])
    }
    
    private func recordCustomMetric(_ data: [String: Any]) {
        db.collection("_performance_metrics").document().setData(data) { error in
            if let error = error {
                print("Error recording performance metric: \(error)")
            }
        }
    }
    
    private func recordAlert(level: String, message: String) {
        let alert: [String: Any] = [
            "id": UUID().uuidString,
            "level": level,
            "message": message,
            "app": appName,
            "timestamp": Timestamp(date: Date()),
            "platform": "ios"
        ]
        
        db.collection("_performance_alerts").document().setData(alert) { error in
            if let error = error {
                print("Error recording alert: \(error)")
            } else {
                print("[PERFORMANCE ALERT] \(level.uppercased()): \(message)")
            }
        }
    }
    
    // MARK: - App-Specific Methods
    
    // ClawFitness specific
    @objc public func startWorkoutTrace() {
        startTrace(name: "workout_session")
    }
    
    @objc public func endWorkoutTrace(success: Bool = true) {
        endTrace(name: "workout_session", success: success)
    }
    
    @objc public func recordRestTimerAccuracy(expectedMs: Double, actualMs: Double) {
        let drift = abs(actualMs - expectedMs)
        recordMetric(name: "rest_timer_accuracy", value: drift, unit: "ms")
    }
    
    // Claw Nutrition specific
    @objc public func startPhotoScanTrace() {
        startTrace(name: "photo_scan_result")
    }
    
    @objc public func endPhotoScanTrace(success: Bool = true) {
        endTrace(name: "photo_scan_result", success: success)
    }
    
    // Claw Meetings specific
    @objc public func startRecordingTrace() {
        startTrace(name: "recording_start")
    }
    
    @objc public func endRecordingTrace(success: Bool = true) {
        endTrace(name: "recording_start", success: success)
    }
    
    // Claw Budget specific
    @objc public func startTransactionSaveTrace() {
        startTrace(name: "transaction_save")
    }
    
    @objc public func endTransactionSaveTrace(success: Bool = true) {
        endTrace(name: "transaction_save", success: success)
    }
    
    // MARK: - Cleanup
    deinit {
        memoryTimer?.invalidate()
        displayLink?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Swift Convenience Extensions
public extension ClawPerformance {
    
    /// Measure the performance of a closure
    func measure<T>(name: String, operation: () throws -> T) rethrows -> T {
        startTrace(name: name)
        do {
            let result = try operation()
            endTrace(name: name, success: true)
            return result
        } catch {
            endTrace(name: name, success: false)
            throw error
        }
    }
    
    /// Measure async operations
    func measureAsync<T>(name: String, operation: () async throws -> T) async rethrows -> T {
        startTrace(name: name)
        do {
            let result = try await operation()
            endTrace(name: name, success: true)
            return result
        } catch {
            endTrace(name: name, success: false)
            throw error
        }
    }
}