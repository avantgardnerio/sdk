import { EventEmitter } from 'events';

import Api from '../api';
import DefaultLogger from './../../utilitis/logger';
import UvcBaseDevice from './uvcbase';
import ITransport from './../../interfaces/iTransport';
import IDeviceManager from './../../interfaces/iDeviceManager';
import IDetector from './../../interfaces/IDetector';
import IDeviceUpgrader from './../../interfaces/IDeviceUpgrader';
import UpgradeOpts from './../../interfaces/IUpgradeOpts';
import InterpolationParams from './../../interfaces/InterpolationParams';
import Locksmith from './../locksmith';
import CameraEvents from './../../utilitis/events';
import HuddlyGoUpgrader from './../upgrader/huddlygoUpgrader';
import { DiagnosticsMessage, MinMaxDiagnosticsMessage } from '../diagnosticsMessage';
import IAutozoomControl from '../../interfaces/IAutozoomControl';
import ReleaseChannel from './../../interfaces/ReleaseChannelEnum';

const FETCH_UX_CONTROLS_ATTEMPTS = 10;

const round = (number, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
};

const parseSoftwareVersion = (versionInfo) => {
  if (versionInfo === null) return '0.0.4';
  const appVersionBuffer = versionInfo.slice(1, 4); // First byte is unused
  appVersionBuffer.reverse(); // Least signiticant first. ask Torleiv
  const appVersion = appVersionBuffer.join('.'); // Make it semver
  const bootVersionBuffer = versionInfo.slice(5, 8); // First byte is unused
  bootVersionBuffer.reverse();
  const bootVersion = bootVersionBuffer.join('.');
  return { mv2_boot: bootVersion, mv2_app: appVersion };
};
export default class HuddlyGo extends UvcBaseDevice implements IDeviceManager {
  transport: ITransport;
  api: Api;
  uvcControlInterface: any;
  hidApi: any;
  logger: DefaultLogger;
  locksmith: Locksmith;
  softwareVersion: any;
  discoveryEmitter: EventEmitter;

  constructor(
    uvcCameraInstance: any,
    transport: ITransport,
    uvcControlInterface: any,
    hidAPI: any,
    logger: DefaultLogger,
    cameraDiscoveryEmitter: EventEmitter) {
    super(uvcCameraInstance, uvcControlInterface);

    this.transport = transport;
    this.uvcControlInterface = uvcControlInterface;
    this.hidApi = hidAPI;
    this.logger = logger;
    this.locksmith = new Locksmith();
    this.discoveryEmitter = cameraDiscoveryEmitter;
  }

  async initialize(): Promise<void> {
    this.api = new Api(this.transport, this.logger, this.locksmith);
    this.softwareVersion = await this.getSoftwareVersion();
  }

  async closeConnection(): Promise<any> {
    return this.transport.close();
  }

  async getSoftwareVersion(retryAttempts = FETCH_UX_CONTROLS_ATTEMPTS) {
    let fetchAttemts = 0;
    let err;
    do {
      try {
        fetchAttemts += 1;
        const versionInfo = await this.getXUControl(19);
        const softwareVersion = parseSoftwareVersion(versionInfo);
        return softwareVersion;
      } catch (e) {
        err = e;
        this.logger.error(
          `Failed parsing/reading the software version on GO! Retry Attempts left: ${fetchAttemts - retryAttempts}`,
          e,
          'HuddlyGO API');
      }
    } while (fetchAttemts < retryAttempts);
    this.logger.error('Unable to retrieve software version from camera!', err, 'HuddlyGO API');
    throw new Error('Failed to retrieve software version from camera');
  }

  async getInfo(): Promise<any> {
    const status = this.uvcCamera;
    status.softwareVersion = this.softwareVersion;
    status.temperature = await this.getTemperature();
    status.powerUsage = await this.getPowerUsage();
    status.version = this.softwareVersion.mv2_app;
    //    status.uptime = await this.uptime();
    return status;
  }

  async ensureAppMode(currentMode: string, timeout: number = 10000): Promise<any> {
    if (!currentMode || currentMode === 'app') return Promise.resolve();
    else {
      throw new Error(`Cannot set camera to app mode from ${currentMode} mode!`);
    }
  }

  async getErrorLog(timeout: number = 60000): Promise<any> {
    return this.api.getErrorLog(timeout);
  }

  async eraseErrorLog(timeout: number = 60000): Promise<void> {
    await this.api.eraseErrorLog(timeout);
  }

  async getPowerUsage() {
    const buffVal = await this.getXUControl(3);
    let ret;
    if (buffVal) {
      ret = {
        voltage: {
          min: round(buffVal.readFloatLE(0), 3),
          curr: round(buffVal.readFloatLE(4), 3),
          max: round(buffVal.readFloatLE(8), 3),
        },
        current: {
          min: round(buffVal.readFloatLE(12), 3),
          curr: round(buffVal.readFloatLE(16), 3),
          max: round(buffVal.readFloatLE(20), 3),
        },
        power: {
          min: round(buffVal.readFloatLE(24), 3),
          curr: round(buffVal.readFloatLE(28), 3),
          max: round(buffVal.readFloatLE(32), 3),
        },
      };
    }
    return ret;
  }

  async getTemperature() {
    const buffVal = await this.getXUControl(2);
    let ret;
    if (buffVal) {
      ret = {
        internal: {
          curr: round(buffVal.readFloatLE(0), 2),
          min: round(buffVal.readFloatLE(4), 2),
          max: round(buffVal.readFloatLE(8), 2),
        },
        external: {
          curr: round(buffVal.readFloatLE(12), 2),
          min: round(buffVal.readFloatLE(16), 2),
          max: round(buffVal.readFloatLE(20), 2),
        },
      };
    }
    return ret;
  }

  getPowerMonitorDiagnostics(powerUsage: any): Array<DiagnosticsMessage> {
    const minVoltage = 4.6;
    const maxVoltage = 5.25;
    const voltageTip = 'Check your cables';

    const voltage = new MinMaxDiagnosticsMessage('Voltage',
      minVoltage, maxVoltage, powerUsage.voltage.min,
      powerUsage.voltage.max, powerUsage.voltage.curr, voltageTip, voltageTip);
    return [voltage];
  }

  async getDiagnostics(): Promise<Array<DiagnosticsMessage>> {
    const powerUsage = await this.getPowerUsage();

    const powerDiagnostics = this.getPowerMonitorDiagnostics(powerUsage);

    return powerDiagnostics;
  }

  async getWhitePointAdjust() {
    const buffVal = await this.getXUControl(4);
    let ret;
    if (buffVal) {
      ret = {
        red: round(buffVal.readFloatLE(0), 3),
        blue: round(buffVal.readFloatLE(4), 3),
      };
    }
    return ret;
  }

  async reboot(mode: string): Promise<void> {
    let bootValue;
    switch (mode) {
      case 'bl':
        bootValue = 0x1399;
        break;
      case 'app':
      default:
        bootValue = 0x3;
        break;
    }
    await this.transport.stopEventLoop();
    await this.setXUControl(17, 0x3974);
    await this.setXUControl(17, bootValue);
  }

  async setCameraMode(mode) {
    if (mode === undefined || mode === null) {
      throw new Error('camera mode undefined');
    }
    let cameraMode = 0;
    switch (mode) {
      case 'normal':
        cameraMode = 0;
        break;
      case 'dual':
        cameraMode = 1;
        break;
      case 'high-res':
        cameraMode = 2;
        break;
      default:
        throw new Error(`Unknown camera mode ${mode}`);
    }
    await this.setXUControl(1, 0x3974);
    await this.setXUControl(1, 0x8eb0);
    await this.setXUControl(1, cameraMode);
    await this.reboot('app');
  }

  async getCameraMode() {
    const xuCtrl = 1;
    const buffer = await this.getXUControl(xuCtrl);
    if (!buffer) {
      return 'normal';
    }
    switch (buffer.readUIntLE(0, 2)) {
      case 0x00:
        return 'normal';
      case 0x01:
        return 'dual';
      case 0x02:
        return 'high-res';
      default:
        return 'unknown';
    }
  }

  async uptime() {
    return this.api.getUptime();
  }

  async getUpgrader(): Promise<IDeviceUpgrader> {
    return new HuddlyGoUpgrader(this, this.discoveryEmitter, this.hidApi, this.logger);
  }

  async upgrade(opts: UpgradeOpts): Promise<any> {
    const upgrader = await this.getUpgrader();
    upgrader.init(opts);
    upgrader.start();
    return new Promise((resolve, reject) => {
      upgrader.once(CameraEvents.UPGRADE_COMPLETE, () => {
        resolve();
      });
      upgrader.once(CameraEvents.UPGRADE_FAILED, (reason) => {
        this.logger.error('Upgrade Failed', reason, 'HuddlyGO API');
        reject(reason);
      });
      upgrader.once(CameraEvents.TIMEOUT, (reason) => {
        this.logger.error('Upgrader returned a timeout event', reason, 'HuddlyGO API');
        reject(reason);
      });
    });
  }

  getAutozoomControl(): IAutozoomControl {
    this.logger.warn('Attempting to call method [getAutozoomControl] on HuddlyGO', 'HuddlyGO API');
    throw new Error('Autozoom is not supported on Huddly GO cameras!');
  }

  getDetector(): IDetector {
    this.logger.warn('Attempting to call method [getDetector] on HuddlyGO', 'HuddlyGO API');
    throw new Error('Detections are not supported on Huddly GO camera!');
  }

  getState(): Promise<any> {
    this.logger.warn('Attempting to call method [getState] on HuddlyGO', 'HuddlyGO API');
    throw new Error('State is not supported on Huddly GO camera');
  }

  async setInterpolationParams(params: InterpolationParams): Promise<any> {
    this.logger.warn('Attempting to call method [setInterpolationParams] on HuddlyGO', 'HuddlyGO API');
    throw new Error('Interpolation parameters are not supported on Huddly GO camera');
  }

  async getInterpolationParams(): Promise<InterpolationParams> {
    this.logger.warn('Attempting to call method [getInterpolationParams] on HuddlyGO', 'HuddlyGO API');
    throw new Error('Interpolation parameters are not supported on Huddly GO camera');
  }

  async getLatestFirmwareUrl(releaseChannel: ReleaseChannel = ReleaseChannel.STABLE) {
    return this.api.getLatestFirmwareUrl('go', releaseChannel);
  }
}
