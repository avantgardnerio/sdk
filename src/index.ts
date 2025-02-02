import { EventEmitter } from 'events';
import IHuddlyDeviceAPI from './interfaces/iHuddlyDeviceAPI';
import DefaultLogger from './utilitis/logger';
import DeviceFactory from './components/device/factory';
import CameraEvents from './utilitis/events';
import Locksmith from './components/locksmith';
import Api from './components/api';
import sourceMapSupport from 'source-map-support';
import ErrorCodes from './error/errorCodes';

sourceMapSupport.install();

class AttachError extends Error {
  code: Number;
  constructor(message: string, code: Number) {
    super(message);
    this.code = code;
  }
}

/**
 * The SDK initialization options.
 *
 * @interface SDKOpts
 */
interface SDKOpts {
  /**
   * Logger instance used to log messages from the SDK.
   *
   * @type {*}
   * @memberof SDKOpts
   */
  logger?: any;
  /**
   * Optional event emitter instance used to catch
   * SDK events!
   * See `utilitis/events` class for all possible events.
   *
   * @type {EventEmitter}
   * @memberof SDKOpts
   */
  emitter?: EventEmitter;

  /**
   * @ignore
   *
   * @type {EventEmitter}
   * @memberof SDKOpts
   */
  apiDiscoveryEmitter?: EventEmitter;

  /**
   * @ignore
   *
   * @type {string}
   * @memberof SDKOpts
   */
  serial?: string;
}

/**
 * @export
 *
 * @class HuddlySdk
 * @implements {SDK}
 */
class HuddlySdk extends EventEmitter {
  /**
   * Event Emitter instance used to fire SDK events such as
   * ATTACH and DETACH camera events. For a full list of events
   * please see `events` class.
   *
   * @type {EventEmitter}
   * @memberof HuddlySdk
   */
  emitter: EventEmitter;

  /**
   * Logger instance used to log messages from the SDK.
   *
   * @type {DefaultLogger}
   * @memberof HuddlySdk
   */
  logger: DefaultLogger;

  /**
   * @ignore
   *
   * @type {EventEmitter}
   * @memberof HuddlySdk
   */
  deviceDiscovery: EventEmitter;
  /**
   * @ignore
   *
   * @type {IHuddlyDeviceAPI}
   * @memberof HuddlySdk
   */
  _mainDeviceApi: IHuddlyDeviceAPI;

  /**
   * @ignore
   *
   * @type {Array<IHuddlyDeviceAPI>}
   * @memberof HuddlySdk
   */
  _deviceApis: Array<IHuddlyDeviceAPI>;

  /**
   * @ignore
   *
   * @type {IHuddlyDeviceAPI}
   * @memberof HuddlySdk
   */
  _deviceDiscoveryApi: IHuddlyDeviceAPI;

  private locksmith: Locksmith;
  private targetSerial: string;

  /**
   * Creates an instance of HuddlySdk.
   * @param {IHuddlyDeviceAPI} deviceDiscoveryApi The Huddly device-api used for discovering the device.
   * @param {Array<IHuddlyDeviceAPI>} [deviceApis] Optional list of device-apis used for communicating with the device.
   * By default it uses the `deviceDiscoveryApi` parameter as the device-api used for communication.
   * @param {SDKOpts} [opts] Options used for initializing the sdk. See `SDKOpts` interface.
   * @memberof HuddlySdk
   */
  constructor(
    deviceDiscoveryApi: IHuddlyDeviceAPI,
    deviceApis?: Array<IHuddlyDeviceAPI>,
    opts?: SDKOpts
  ) {
    super();
    if (!deviceDiscoveryApi) {
      throw new Error('A default device api should be provided to the sdk!');
    }

    if (!deviceApis || deviceApis.length === 0) {
      this.mainDeviceApi = deviceDiscoveryApi;
      this._deviceApis = new Array<IHuddlyDeviceAPI>();
      this._deviceApis.push(deviceDiscoveryApi);

    } else {
      this._mainDeviceApi = deviceApis[0];
      this._deviceApis = deviceApis;
    }

    this.locksmith = new Locksmith();

    const options = opts ? opts : {};

    this.deviceDiscovery = options.apiDiscoveryEmitter || new EventEmitter();
    this.emitter = options.emitter || this;
    this._deviceDiscoveryApi = deviceDiscoveryApi;
    this.logger = options.logger || new DefaultLogger(true);
    this.targetSerial = options.serial;

    this.setupDeviceDiscoveryListeners();
    this._deviceDiscoveryApi.registerForHotplugEvents(this.deviceDiscovery);
  }

  /**
   * Sets up listeners for ATTACH and DETACH camera events on the
   * device discovery api.
   * Will emit instances of `IDeviceManager` when an ATTACH event occurs.
   * Will emit the device serial number when a DETACH event occurs.
   * @memberof HuddlySdk
   */
  setupDeviceDiscoveryListeners(): void {
    this.deviceDiscovery.on(CameraEvents.ATTACH, async d => {
      if (d && (!this.targetSerial || (this.targetSerial === d.serialNumber)) ) {
        await this.locksmith.executeAsyncFunction(
          () =>
            new Promise(async resolve => {
              try {
                const cameraManager = await DeviceFactory.getDevice(
                  d.productId,
                  this.logger,
                  this.mainDeviceApi,
                  this.deviceApis,
                  d,
                  this.emitter
                );

                this.emitter.emit(CameraEvents.ATTACH, cameraManager);
                resolve();
              } catch (e) {
                this.logger.error(`Could not get device ${e}`, 'SDK');
                this.emitter.emit(CameraEvents.ERROR, new AttachError('No transport supported', ErrorCodes.NO_TRANSPORT));
              }
            })
        );
      }
    });

    this.deviceDiscovery.on(CameraEvents.DETACH, async (d) => {
      if (d !== undefined  && (!this.targetSerial || (this.targetSerial === d))) {
        await this.locksmith.executeAsyncFunction(() => new Promise((resolve) => {
          this.emitter.emit(CameraEvents.DETACH, d);
          resolve();
        }));
      }
    });
  }

  /**
   * Convenience function for setting the main device api
   * used for communicating with the camera.
   *
   * @memberof HuddlySdk
   */
  set mainDeviceApi(mainApi: IHuddlyDeviceAPI) {
    this._mainDeviceApi = mainApi;
  }

  /**
   * Convenience function for getting the main device api
   * used for communicating with the camera.
   *
   * @type {IHuddlyDeviceAPI}
   * @memberof HuddlySdk
   */
  get mainDeviceApi(): IHuddlyDeviceAPI {
    return this._mainDeviceApi;
  }

  /**
   * Convenience function for setting the list of
   * device apis which the SDK uses to establish
   * communication channels with the camera.
   *
   * @memberof HuddlySdk
   */
  set deviceApis(deviceApis: Array<IHuddlyDeviceAPI>) {
    this._deviceApis = deviceApis;
  }

  /**
   * Convenience function for getting the list of
   * device apis used to establish communication with
   * the camera.
   *
   * @type {Array<IHuddlyDeviceAPI>}
   * @memberof HuddlySdk
   */
  get deviceApis(): Array<IHuddlyDeviceAPI> {
    return this._deviceApis;
  }

  /**
   * Convenience function for setting the device api
   * instance used for camera discovery.
   *
   * @memberof HuddlySdk
   */
  set deviceDiscoveryApi(api: IHuddlyDeviceAPI) {
    this._deviceDiscoveryApi = api;
    this.deviceDiscoveryApi.registerForHotplugEvents(this.deviceDiscovery);
  }

  /**
   * Convenience function for getting the device api
   * instance used for camera discovery.
   *
   * @type {IHuddlyDeviceAPI}
   * @memberof HuddlySdk
   */
  get deviceDiscoveryApi(): IHuddlyDeviceAPI {
    return this._deviceDiscoveryApi;
  }

  /**
   * Initializes the device discovery api which in turn will fire
   * ATTACH events for all cameras attached to the system.
   *
   * @returns {Promise<any>} Returns a promise which resolves for
   * successful initialization or rejects otherwise.
   * @memberof HuddlySdk
   */
  async init(): Promise<any> {
    await this.deviceDiscoveryApi.initialize();
  }
}
export { CameraEvents, Api };

export default HuddlySdk;
