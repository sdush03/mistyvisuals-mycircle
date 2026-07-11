const faceRecManager = require('../utils/faceRecManager');
const path = require('path');
const fs = require('fs');

async function runTests() {
  const samplePhoto = path.join(
    __dirname,
    '../uploads/photos/events/pooja-raj-jul26/photos/DSC07295.JPG'
  );

  if (!fs.existsSync(samplePhoto)) {
    console.error(`Sample photo not found at: ${samplePhoto}`);
    process.exit(1);
  }

  console.log('--- TEST 1: Daemon Startup and Validation (Cold Start vs Hot Start) ---');
  
  // Cold validation (first run starts the daemon and loads models)
  console.time('Cold Validation');
  try {
    const coldRes = await faceRecManager.validateSelfie(samplePhoto);
    console.timeEnd('Cold Validation');
    console.log('Cold Validation Result:', coldRes.success ? 'Success' : 'Failed', coldRes.error || '');
  } catch (err) {
    console.timeEnd('Cold Validation');
    console.error('Cold validation error:', err);
  }

  // Hot validation (runs on running daemon)
  console.time('Hot Validation 1');
  try {
    const hotRes = await faceRecManager.validateSelfie(samplePhoto);
    console.timeEnd('Hot Validation 1');
    console.log('Hot Validation 1 Result:', hotRes.success ? 'Success' : 'Failed', hotRes.error || '');
  } catch (err) {
    console.timeEnd('Hot Validation 1');
    console.error('Hot validation 1 error:', err);
  }

  console.time('Hot Validation 2');
  try {
    const hotRes2 = await faceRecManager.validateSelfie(samplePhoto);
    console.timeEnd('Hot Validation 2');
    console.log('Hot Validation 2 Result:', hotRes2.success ? 'Success' : 'Failed', hotRes2.error || '');
  } catch (err) {
    console.timeEnd('Hot Validation 2');
    console.error('Hot validation 2 error:', err);
  }

  console.log('\n--- TEST 2: Verify Anchor ---');
  // Get vector from validateSelfie first if successful
  let sampleVector = Array(512).fill(0);
  try {
    const valRes = await faceRecManager.validateSelfie(samplePhoto);
    if (valRes.vector) {
      sampleVector = valRes.vector;
      console.log('Extracted sample vector successfully.');
    }
  } catch (e) {
    console.error('Failed to extract vector for verification test:', e.message);
  }

  console.time('Verify Anchor');
  try {
    const verifyRes = await faceRecManager.verifyAnchor(samplePhoto, sampleVector);
    console.timeEnd('Verify Anchor');
    console.log('Verify Anchor Result:', verifyRes.verified ? 'Verified!' : 'Not Verified', verifyRes.score || '');
  } catch (err) {
    console.timeEnd('Verify Anchor');
    console.error('Verify Anchor error:', err);
  }

  console.log('\n--- TEST 3: Match Selfie ---');
  const dbVectors = [
    {
      photoId: 'photo_1',
      faceId: 'face_1',
      vector: sampleVector
    }
  ];

  console.time('Match Selfie');
  try {
    const matchRes = await faceRecManager.matchSelfie(samplePhoto, dbVectors);
    console.timeEnd('Match Selfie');
    console.log('Match Selfie Matches Count:', matchRes.matches ? matchRes.matches.length : 0);
  } catch (err) {
    console.timeEnd('Match Selfie');
    console.error('Match Selfie error:', err);
  }

  console.log('\n--- TEST 4: Auto-Restart Daemon on Crash ---');
  console.log('Killing Python process to simulate crash...');
  if (faceRecManager.pythonDaemon) {
    faceRecManager.pythonDaemon.kill('SIGKILL');
  }

  // Let the event loop handle the exit event
  await new Promise(r => setTimeout(r, 200));

  console.log('Verifying daemon restarts automatically on next request...');
  console.time('Restart & Validation');
  try {
    const resAfterCrash = await faceRecManager.validateSelfie(samplePhoto);
    console.timeEnd('Restart & Validation');
    console.log('Result After Crash Recovery:', resAfterCrash.success ? 'Success' : 'Failed');
  } catch (err) {
    console.timeEnd('Restart & Validation');
    console.error('Recovery validation error:', err);
  }

  // Shutdown daemon at the end of the script
  faceRecManager.shutdown();
  console.log('\nAll tests completed.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  faceRecManager.shutdown();
  process.exit(1);
});
