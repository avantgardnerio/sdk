const trackPeopleCount = require('./tracker');
const HuddlyDeviceAPIUSB = require('@huddly/device-api-usb').default;
const HuddlySdk = require('@huddly/sdk').default;

const meetingRoomName = process.env.HUDDLY_MEETING_ROOM || 'TEST_ROOM';

const usbApi = new HuddlyDeviceAPIUSB();

// Create an instance of the SDK
const sdk = new HuddlySdk(usbApi, [usbApi]);

let count = 0;

async function init() {
  await sdk.init();

  sdk.on('ATTACH', async (cameraManager) => {
    const detector = await cameraManager.getDetector({DOWS: false, shouldAutoFrame: false});
    await detector.init();

    detector.on('DETECTIONS', detections => {
      console.log(`${JSON.stringify(detections)}`)
    });

    detector.start();
  });
}

init();
