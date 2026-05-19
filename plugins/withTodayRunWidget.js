const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  createRunOncePlugin,
  withEntitlementsPlist,
  withXcodeProject,
} = require("@expo/config-plugins");

const WIDGET_NAME = "TodayRunWidget";
const SNAPSHOT_KEY = "training_widget_snapshot";

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === contents) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function getBundleIdentifier(config) {
  return config.ios?.bundleIdentifier || "com.bickers.beapp";
}

function getAppGroupIdentifier(config, props = {}) {
  return props.appGroupIdentifier || `group.${getBundleIdentifier(config)}.widgets`;
}

function getNativeProjectName(iosRoot, config) {
  try {
    return IOSConfig.XcodeUtils.getProjectName(iosRoot);
  } catch {}

  const project = fs
    .readdirSync(iosRoot)
    .find((entry) => entry.endsWith(".xcodeproj") && !entry.includes(" 2") && !entry.includes(" 3"));
  if (project) return project.replace(/\.xcodeproj$/, "");

  return String(config.name || "Be").replace(/[^\w.-]/g, "");
}

function plist(contents) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${contents}
</plist>
`;
}

function appNativeModuleSwift(appGroupIdentifier) {
  return `import Foundation
import React
import WidgetKit

@objc(TrainingWidgetSnapshot)
class TrainingWidgetSnapshot: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(writeSnapshot:resolver:rejecter:)
  func writeSnapshot(_ json: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: "${appGroupIdentifier}") else {
      reject("E_APP_GROUP_UNAVAILABLE", "Could not open shared widget app group storage.", nil)
      return
    }

    defaults.set(json, forKey: "${SNAPSHOT_KEY}")
    defaults.set(Date().timeIntervalSince1970, forKey: "${SNAPSHOT_KEY}_updated_at")
    defaults.synchronize()

    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }

    resolve(true)
  }

  @objc(clearSnapshot:rejecter:)
  func clearSnapshot(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: "${appGroupIdentifier}") else {
      reject("E_APP_GROUP_UNAVAILABLE", "Could not open shared widget app group storage.", nil)
      return
    }

    defaults.removeObject(forKey: "${SNAPSHOT_KEY}")
    defaults.removeObject(forKey: "${SNAPSHOT_KEY}_updated_at")
    defaults.synchronize()

    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }

    resolve(true)
  }
}
`;
}

function appNativeModuleBridge() {
  return `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(TrainingWidgetSnapshot, NSObject)

RCT_EXTERN_METHOD(writeSnapshot:(NSString *)json
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearSnapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
`;
}

function widgetSwift(appGroupIdentifier) {
  return `import SwiftUI
import WidgetKit

private let appGroupIdentifier = "${appGroupIdentifier}"
private let snapshotKey = "${SNAPSHOT_KEY}"

struct TrainingWidgetSnapshot: Codable {
  let updatedAt: String?
  let activePlanId: String?
  let activePlanName: String?
  let todaySession: TrainingWidgetSession?
  let nextSession: TrainingWidgetSession?
  let weeklyProgress: WeeklyProgress?
}

struct TrainingWidgetSession: Codable {
  let title: String?
  let runType: String?
  let distanceText: String?
  let durationText: String?
  let keyTarget: String?
  let completed: Bool?
  let status: String?
  let nextAction: String?
  let deepLinks: TrainingWidgetLinks?
}

struct TrainingWidgetLinks: Codable {
  let session: String?
  let complete: String?
  let plan: String?
}

struct WeeklyProgress: Codable {
  let plannedRuns: Int?
  let completedRuns: Int?
  let plannedKm: Double?
  let completedKm: Double?
}

struct TodayRunEntry: TimelineEntry {
  let date: Date
  let snapshot: TrainingWidgetSnapshot?
}

struct TodayRunProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayRunEntry {
    TodayRunEntry(date: Date(), snapshot: TrainingWidgetSnapshot(
      updatedAt: nil,
      activePlanId: nil,
      activePlanName: "Training plan",
      todaySession: TrainingWidgetSession(
        title: "Easy run",
        runType: "Easy",
        distanceText: "6 km",
        durationText: nil,
        keyTarget: "Keep it relaxed and conversational.",
        completed: false,
        status: "planned",
        nextAction: "Log run",
        deepLinks: nil
      ),
      nextSession: nil,
      weeklyProgress: WeeklyProgress(plannedRuns: 3, completedRuns: 1, plannedKm: 20, completedKm: 6)
    ))
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayRunEntry) -> Void) {
    completion(TodayRunEntry(date: Date(), snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayRunEntry>) -> Void) {
    let entry = TodayRunEntry(date: Date(), snapshot: loadSnapshot())
    let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
    completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
  }

  private func loadSnapshot() -> TrainingWidgetSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: appGroupIdentifier),
      let json = defaults.string(forKey: snapshotKey),
      let data = json.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONDecoder().decode(TrainingWidgetSnapshot.self, from: data)
  }
}

struct TodayRunWidgetView: View {
  @Environment(\\.widgetFamily) private var family
  let entry: TodayRunEntry

  private enum DisplayState {
    case noSnapshot
    case noActivePlan
    case noRunToday(next: TrainingWidgetSession?)
    case session(TrainingWidgetSession)
  }

  private var displayState: DisplayState {
    guard let snapshot = entry.snapshot else {
      return .noSnapshot
    }
    if snapshot.activePlanId == nil && snapshot.todaySession == nil && snapshot.nextSession == nil {
      return .noActivePlan
    }
    if let todaySession = snapshot.todaySession {
      return .session(todaySession)
    }
    return .noRunToday(next: snapshot.nextSession)
  }

  private var currentSession: TrainingWidgetSession? {
    switch displayState {
    case .session(let session):
      return session
    default:
      return nil
    }
  }

  private var planDeepLink: String? {
    entry.snapshot?.todaySession?.deepLinks?.plan ?? entry.snapshot?.nextSession?.deepLinks?.plan
  }

  var body: some View {
    let widgetLink = url(currentSession?.deepLinks?.session ?? planDeepLink)
    ZStack {
      Color(red: 0.02, green: 0.02, blue: 0.02)
      VStack(alignment: .leading, spacing: family == .systemSmall ? 7 : 10) {
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Today's Run")
              .font(.caption2.weight(.bold))
              .foregroundStyle(Color(red: 0.90, green: 1.0, blue: 0.23))
            planTitle
          }
          Spacer(minLength: 6)
          statusPill
        }

        content

        Spacer(minLength: 0)
      }
      .padding(14)
    }
    .widgetURL(widgetLink)
  }

  @ViewBuilder
  private var content: some View {
    switch displayState {
    case .noSnapshot:
      fallbackContent(
        title: "Open Be",
        message: "Your training widget will appear after the app syncs."
      )
    case .noActivePlan:
      fallbackContent(
        title: "No active plan",
        message: "Create or open a run plan in Be to start tracking today's run."
      )
    case .noRunToday(let next):
      let nextText = next?.title.map { "Next: \\($0)" } ?? "Open your plan for the week."
      fallbackContent(
        title: "No run today",
        message: nextText
      )
    case .session(let session):
      sessionContent(session)
    }
  }

  private func sessionContent(_ session: TrainingWidgetSession) -> some View {
    VStack(alignment: .leading, spacing: family == .systemSmall ? 7 : 10) {
      Text(session.title ?? "Run")
        .font((family == .systemSmall ? Font.body : Font.title3).weight(.bold))
        .foregroundStyle(.white)
        .lineLimit(2)
        .minimumScaleFactor(0.82)

      HStack(spacing: 6) {
        metricPill(session.runType ?? "Run")
        if let distance = session.distanceText {
          metricPill(distance)
        } else if let duration = session.durationText {
          metricPill(duration)
        }
      }

      Text(session.completed == true ? "Completed today. Open Be to review your run." : (session.keyTarget ?? "Open the app for today's session."))
        .font(.caption)
        .foregroundStyle(.white.opacity(0.72))
        .lineLimit(family == .systemSmall ? 2 : 3)

      if family != .systemSmall {
        HStack(spacing: 8) {
          actionLink(session)
          weeklyProgress
        }
      }
    }
  }

  private func fallbackContent(title: String, message: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.headline.weight(.bold))
        .foregroundStyle(.white)
        .lineLimit(2)
        .minimumScaleFactor(0.82)
      Text(message)
        .font(.caption)
        .foregroundStyle(.white.opacity(0.70))
        .lineLimit(family == .systemSmall ? 2 : 3)
      if family != .systemSmall {
        weeklyProgress
      }
    }
  }

  private var planTitle: some View {
    let label = entry.snapshot?.activePlanName ?? "Be Training"
    if let planUrl = url(planDeepLink) {
      return AnyView(Link(destination: planUrl) {
        Text(label)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.58))
          .lineLimit(1)
      })
    }
    return AnyView(Text(label).font(.caption2).foregroundStyle(.white.opacity(0.58)).lineLimit(1))
  }

  private var statusPill: some View {
    let complete = currentSession?.completed == true
    let label: String
    switch displayState {
    case .noSnapshot:
      label = "OPEN"
    case .noActivePlan:
      label = "PLAN"
    case .noRunToday:
      label = "REST"
    case .session:
      label = complete ? "DONE" : "RUN"
    }
    let pill = Text(label)
      .font(.caption2.weight(.black))
      .foregroundStyle(complete ? Color.white : Color.black)
      .padding(.horizontal, 8)
      .padding(.vertical, 5)
      .background(complete ? Color.green.opacity(0.85) : Color(red: 0.90, green: 1.0, blue: 0.23))
      .clipShape(Capsule())
    if let completeUrl = url(currentSession?.deepLinks?.complete ?? currentSession?.deepLinks?.session ?? planDeepLink) {
      return AnyView(Link(destination: completeUrl) { pill })
    }
    return AnyView(pill)
  }

  private var weeklyProgress: some View {
    let progress = entry.snapshot?.weeklyProgress
    let done = progress?.completedRuns ?? 0
    let planned = progress?.plannedRuns ?? 0
    return Text(planned > 0 ? "\\(done)/\\(planned) runs" : "Open plan")
      .font(.caption2.weight(.semibold))
      .foregroundStyle(.white.opacity(0.62))
      .lineLimit(1)
  }

  private func actionLink(_ session: TrainingWidgetSession) -> some View {
    let label = session.completed == true ? "View session" : (session.nextAction ?? "Log run")
    if let completeUrl = url(session.deepLinks?.complete ?? session.deepLinks?.session) {
      return AnyView(Link(destination: completeUrl) {
        Text(label)
          .font(.caption.weight(.bold))
          .foregroundStyle(Color.black)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(Color(red: 0.90, green: 1.0, blue: 0.23))
          .clipShape(Capsule())
      })
    }
    return AnyView(EmptyView())
  }

  private func metricPill(_ text: String) -> some View {
    Text(text)
      .font(.caption2.weight(.bold))
      .foregroundStyle(.white.opacity(0.82))
      .padding(.horizontal, 7)
      .padding(.vertical, 4)
      .background(Color.white.opacity(0.12))
      .clipShape(Capsule())
      .lineLimit(1)
  }

  private func url(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    return URL(string: raw)
  }
}

struct TodayRunWidget: Widget {
  let kind: String = "TodayRunWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TodayRunProvider()) { entry in
      TodayRunWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's Run")
    .description("See today's planned run from Be and jump straight into the session.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
`;
}

function widgetBundleSwift() {
  return `import WidgetKit
import SwiftUI

@main
struct TodayRunWidgetBundle: WidgetBundle {
  var body: some Widget {
    TodayRunWidget()
  }
}
`;
}

function widgetInfoPlist(bundleIdentifier) {
  return plist(`<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Today's Run</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>`);
}

function widgetEntitlements(appGroupIdentifier) {
  return plist(`<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${appGroupIdentifier}</string>
  </array>
</dict>`);
}

function getBuildConfigurationsForTarget(project, target) {
  const nativeTarget = target?.pbxNativeTarget || target?.target || target?.firstTarget || target;
  const listId = nativeTarget?.buildConfigurationList;
  const list = project.hash.project.objects.XCConfigurationList?.[listId];
  const configs = Array.isArray(list?.buildConfigurations) ? list.buildConfigurations : [];
  return configs
    .map((entry) => project.hash.project.objects.XCBuildConfiguration?.[entry.value])
    .filter(Boolean);
}

function buildSettingsByConfigName(project, target) {
  const settings = new Map();
  getBuildConfigurationsForTarget(project, target).forEach((buildConfig) => {
    if (buildConfig.name) {
      settings.set(buildConfig.name, buildConfig.buildSettings || {});
    }
  });
  return settings;
}

function ensureBuildPhase(project, targetUuid, phaseType, comment) {
  const target = project.pbxNativeTargetSection()?.[targetUuid];
  const phases = Array.isArray(target?.buildPhases) ? target.buildPhases : [];
  const section = project.hash.project.objects[phaseType] || {};
  const hasPhase = phases.some((phase) => {
    const obj = section[phase.value];
    return obj?.isa === phaseType || phase.comment === comment;
  });
  if (!hasPhase) {
    project.addBuildPhase([], phaseType, comment, targetUuid);
  }
}

function withTodayRunWidgetFiles(config, props) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const iosRoot = configWithProject.modRequest.platformProjectRoot;
    const projectName = getNativeProjectName(iosRoot, configWithProject);
    const bundleIdentifier = getBundleIdentifier(configWithProject);
    const widgetBundleIdentifier = props.widgetBundleIdentifier || `${bundleIdentifier}.TodayRunWidget`;
    const appGroupIdentifier = getAppGroupIdentifier(configWithProject, props);

    const appSourceDir = path.join(iosRoot, projectName);
    writeFileIfChanged(
      path.join(appSourceDir, "TrainingWidgetSnapshot.swift"),
      appNativeModuleSwift(appGroupIdentifier)
    );
    writeFileIfChanged(
      path.join(appSourceDir, "TrainingWidgetSnapshotBridge.m"),
      appNativeModuleBridge()
    );

    const widgetDir = path.join(iosRoot, WIDGET_NAME);
    writeFileIfChanged(path.join(widgetDir, "TodayRunWidget.swift"), widgetSwift(appGroupIdentifier));
    writeFileIfChanged(path.join(widgetDir, "TodayRunWidgetBundle.swift"), widgetBundleSwift());
    writeFileIfChanged(path.join(widgetDir, `${WIDGET_NAME}-Info.plist`), widgetInfoPlist(widgetBundleIdentifier));
    writeFileIfChanged(path.join(widgetDir, `${WIDGET_NAME}.entitlements`), widgetEntitlements(appGroupIdentifier));

    const appTarget =
      project.getTarget("com.apple.product-type.application") || project.getFirstTarget();
    const appSettingsByConfig = buildSettingsByConfigName(project, appTarget);
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, projectName);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${projectName}/TrainingWidgetSnapshot.swift`,
      groupName: projectName,
      project,
      targetUuid: appTarget.uuid,
    });
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${projectName}/TrainingWidgetSnapshotBridge.m`,
      groupName: projectName,
      project,
      targetUuid: appTarget.uuid,
    });

    getBuildConfigurationsForTarget(project, appTarget).forEach((buildConfig) => {
      buildConfig.buildSettings.SWIFT_VERSION = buildConfig.buildSettings.SWIFT_VERSION || "5.0";
      buildConfig.buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES =
        buildConfig.buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES || "YES";
    });

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, WIDGET_NAME);
    let widgetTargetUuid = project.findTargetKey(`"${WIDGET_NAME}"`) || project.findTargetKey(WIDGET_NAME);
    let widgetTarget = widgetTargetUuid
      ? { uuid: widgetTargetUuid, pbxNativeTarget: project.pbxNativeTargetSection()[widgetTargetUuid] }
      : null;
    if (!widgetTarget) {
      widgetTarget = project.addTarget(WIDGET_NAME, "app_extension", WIDGET_NAME, widgetBundleIdentifier);
    }

    ensureBuildPhase(project, widgetTarget.uuid, "PBXSourcesBuildPhase", "Sources");
    ensureBuildPhase(project, widgetTarget.uuid, "PBXResourcesBuildPhase", "Resources");
    ensureBuildPhase(project, widgetTarget.uuid, "PBXFrameworksBuildPhase", "Frameworks");

    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${WIDGET_NAME}/TodayRunWidget.swift`,
      groupName: WIDGET_NAME,
      project,
      targetUuid: widgetTarget.uuid,
    });
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${WIDGET_NAME}/TodayRunWidgetBundle.swift`,
      groupName: WIDGET_NAME,
      project,
      targetUuid: widgetTarget.uuid,
    });

    project.addFramework("WidgetKit.framework", { target: widgetTarget.uuid });
    project.addFramework("SwiftUI.framework", { target: widgetTarget.uuid });

    getBuildConfigurationsForTarget(project, widgetTarget).forEach((buildConfig) => {
      const appBuildSettings = appSettingsByConfig.get(buildConfig.name) || {};
      buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleIdentifier}"`;
      buildConfig.buildSettings.INFOPLIST_FILE = `"${WIDGET_NAME}/${WIDGET_NAME}-Info.plist"`;
      buildConfig.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${WIDGET_NAME}/${WIDGET_NAME}.entitlements"`;
      buildConfig.buildSettings.SWIFT_VERSION = "5.0";
      buildConfig.buildSettings.CURRENT_PROJECT_VERSION =
        appBuildSettings.CURRENT_PROJECT_VERSION ||
        buildConfig.buildSettings.CURRENT_PROJECT_VERSION ||
        "1";
      buildConfig.buildSettings.MARKETING_VERSION =
        configWithProject.version ||
        appBuildSettings.MARKETING_VERSION ||
        buildConfig.buildSettings.MARKETING_VERSION ||
        "1.0";
      buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET =
        buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET || "16.0";
      buildConfig.buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
      buildConfig.buildSettings.SKIP_INSTALL = "YES";
      buildConfig.buildSettings.TARGETED_DEVICE_FAMILY =
        buildConfig.buildSettings.TARGETED_DEVICE_FAMILY || `"1,2"`;
    });

    return configWithProject;
  });
}

function withTodayRunWidget(config, props = {}) {
  const appGroupIdentifier = getAppGroupIdentifier(config, props);

  config = withEntitlementsPlist(config, (configWithEntitlements) => {
    const existing = configWithEntitlements.modResults["com.apple.security.application-groups"];
    const groups = Array.isArray(existing) ? existing : [];
    configWithEntitlements.modResults["com.apple.security.application-groups"] = [
      ...new Set([...groups, appGroupIdentifier]),
    ];
    return configWithEntitlements;
  });

  return withTodayRunWidgetFiles(config, props);
}

module.exports = createRunOncePlugin(withTodayRunWidget, "with-today-run-widget", "1.0.0");
