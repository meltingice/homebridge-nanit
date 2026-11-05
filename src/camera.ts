import {
  HAP,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { NanitPlatform } from './platform';
import { NanitBaby } from './settings';
import { Log, withPrefix } from './log';
import { StreamingDelegate } from './streaming/delegate';
import { LocalSource, VideoSource, cloudSource, withFallback } from './streaming/sources';

export class NanitCamera {
  private readonly hap: HAP;
  private readonly log: Log;
  private readonly streamingDelegate: StreamingDelegate;

  private temperatureService?: Service;
  private humidityService?: Service;

  constructor(
    private readonly platform: NanitPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly baby: NanitBaby,
  ) {
    this.hap = platform.api.hap;
    this.log = withPrefix(platform.log, this.getName());

    this.accessory
      .getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Nanit')
      .setCharacteristic(this.hap.Characteristic.Model, 'Nanit Camera')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, baby.camera?.uid || baby.uid)
      .setCharacteristic(this.hap.Characteristic.FirmwareRevision, '1.0.0');

    this.streamingDelegate = new StreamingDelegate(
      this.hap,
      this.log,
      this.videoSource(),
      () => this.cloudStreamUrl(),
    );
    this.accessory.configureController(this.streamingDelegate.controller);

    this.setupSensors();
  }

  private videoSource(): VideoSource {
    const mode = this.platform.config.streamMode ?? 'auto';
    const cloud = cloudSource(() => this.cloudStreamUrl());
    if (mode === 'cloud') {
      this.log.info('Using cloud streaming');
      return cloud;
    }

    const cameraUid = this.baby.camera?.uid || this.baby.camera_uid;
    if (!cameraUid) {
      this.log.warn('Camera UID not available, using cloud streaming');
      return cloud;
    }

    const local = new LocalSource(this.platform.rtmpRelay, cameraUid, () => this.platform.getAccessToken(), this.log);
    this.log.info(mode === 'local' ? 'Using local streaming' : 'Using local streaming with cloud fallback');
    return mode === 'local' ? local : withFallback(local, cloud, this.log);
  }

  private setupSensors(): void {
    const camera = this.baby.camera;
    if (!camera) {
      return;
    }

    // Temperature sensor
    if (camera.temperature !== undefined) {
      this.temperatureService =
        this.accessory.getService(this.hap.Service.TemperatureSensor) ||
        this.accessory.addService(this.hap.Service.TemperatureSensor, `${this.getName()} Temperature`);

      this.temperatureService
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .onGet(() => camera.temperature || 0);
    }

    // Humidity sensor
    if (camera.humidity !== undefined) {
      this.humidityService =
        this.accessory.getService(this.hap.Service.HumiditySensor) ||
        this.accessory.addService(this.hap.Service.HumiditySensor, `${this.getName()} Humidity`);

      this.humidityService
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .onGet(() => camera.humidity || 0);
    }
  }

  public updateSensors(temperature?: number, humidity?: number): void {
    if (temperature !== undefined && this.temperatureService) {
      this.temperatureService
        .getCharacteristic(this.hap.Characteristic.CurrentTemperature)
        .updateValue(temperature);
    }

    if (humidity !== undefined && this.humidityService) {
      this.humidityService
        .getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
        .updateValue(humidity);
    }
  }

  private getName(): string {
    return this.baby.name || this.baby.first_name || 'Nanit Camera';
  }

  private cloudStreamUrl(): string {
    return `rtmps://media-secured.nanit.com/nanit/${this.baby.uid}.${this.platform.getAccessToken()}`;
  }

  public destroy(): void {
    this.log.debug('Cleaning up camera');
    this.streamingDelegate.destroy();
  }
}
