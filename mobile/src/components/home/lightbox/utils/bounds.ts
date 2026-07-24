import { Dimensions } from 'react-native';

const { width: screenWidth, height: screenHeight } = Dimensions.get('screen');

/**
 * Apple Photos Centering & Boundary Clamping Algorithm
 * Calculated dynamically from actual scaled image dimensions vs viewport bounds.
 */
export const getTargetTransform = (
  s: number,
  tx: number,
  ty: number,
  containerW: number = screenWidth,
  containerH: number = screenHeight * 0.82,
  viewportW: number = screenWidth,
  viewportH: number = screenHeight
) => {
  'worklet';
  const targetScale = Math.min(Math.max(s, 1.0), 5.0);

  if (targetScale <= 1.01) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const scaledW = containerW * targetScale;
  const scaledH = containerH * targetScale;

  let targetTx = 0;
  if (scaledW <= viewportW) {
    targetTx = 0;
  } else {
    const maxTx = (scaledW - viewportW) / 2;
    targetTx = Math.min(Math.max(tx, -maxTx), maxTx);
  }

  let targetTy = 0;
  if (scaledH <= viewportH) {
    targetTy = 0;
  } else {
    const maxTy = (scaledH - viewportH) / 2;
    targetTy = Math.min(Math.max(ty, -maxTy), maxTy);
  }

  return { scale: targetScale, translateX: targetTx, translateY: targetTy };
};

/**
 * Calculates elastic bounds during active dragging/pinching overscroll.
 */
export const applyElasticBounds = (
  s: number,
  tx: number,
  ty: number,
  containerW: number = screenWidth,
  containerH: number = screenHeight * 0.82,
  viewportW: number = screenWidth,
  viewportH: number = screenHeight
) => {
  'worklet';
  const currentScale = Math.min(Math.max(s, 0.8), 5.5);

  const scaledW = containerW * currentScale;
  const scaledH = containerH * currentScale;

  let clampedTx = tx;
  if (scaledW <= viewportW) {
    const maxElastic = viewportW * 0.25;
    clampedTx = Math.min(Math.max(tx, -maxElastic), maxElastic) * 0.35;
  } else {
    const maxTx = (scaledW - viewportW) / 2;
    if (tx > maxTx) {
      clampedTx = maxTx + (tx - maxTx) * 0.35;
    } else if (tx < -maxTx) {
      clampedTx = -maxTx + (tx + maxTx) * 0.35;
    }
  }

  let clampedTy = ty;
  if (scaledH <= viewportH) {
    const maxElastic = viewportH * 0.25;
    clampedTy = Math.min(Math.max(ty, -maxElastic), maxElastic) * 0.35;
  } else {
    const maxTy = (scaledH - viewportH) / 2;
    if (ty > maxTy) {
      clampedTy = maxTy + (ty - maxTy) * 0.35;
    } else if (ty < -maxTy) {
      clampedTy = -maxTy + (ty + maxTy) * 0.35;
    }
  }

  return { scale: currentScale, translateX: clampedTx, translateY: clampedTy };
};
