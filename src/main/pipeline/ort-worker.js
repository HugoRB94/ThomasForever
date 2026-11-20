// Proceso auxiliar (utilityProcess) que ejecuta el modelo ONNX. Vive aparte para que,
// al cerrarse tras un rato sin uso, el sistema recupere toda la memoria del modelo.
const ort = require('onnxruntime-node');

const sessions = new Map();

process.parentPort.on('message', async ({ data }) => {
  const { id, modelPath, input, size } = data;
  try {
    let session = sessions.get(modelPath);
    if (!session) {
      session = await ort.InferenceSession.create(modelPath, { graphOptimizationLevel: 'all' });
      sessions.set(modelPath, session);
    }
    const result = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]),
    });
    process.parentPort.postMessage({ id, mask: Float32Array.from(result[session.outputNames[0]].data) });
  } catch (err) {
    process.parentPort.postMessage({ id, error: err.message });
  }
});
