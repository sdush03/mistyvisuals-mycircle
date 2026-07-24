import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Image } from 'expo-image';
// @ts-ignore
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { useApplePhotosGesture } from '../gestures/AppleGestureEngine';

const { width: defaultScreenWidth, height: defaultScreenHeight } = Dimensions.get('screen');

export interface LightboxImageItemProps {
  item: any;
  width: number;
  onDoubleTap: () => void;
  onNavigate: (direction: 'next' | 'prev') => void;
  onZoomChange: (isZoomed: boolean) => void;
  onToggleControls: () => void;
  onCloseLightbox: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  expandProgress: SharedValue<number>;
  heartPopScale: SharedValue<number>;
  heartPopOpacity: SharedValue<number>;
}

export const LightboxImageItem = React.memo(function LightboxImageItem({
  item,
  width = defaultScreenWidth,
  onDoubleTap,
  onNavigate,
  onZoomChange,
  onToggleControls,
  onCloseLightbox,
  onInteractionStart,
  onInteractionEnd,
  expandProgress,
  heartPopScale,
  heartPopOpacity,
}: LightboxImageItemProps) {
  const {
    scale,
    translateX,
    translateY,
    composedGesture,
  } = useApplePhotosGesture({
    width,
    screenHeight: defaultScreenHeight,
    containerW: width,
    containerH: defaultScreenHeight * 0.82,
    expandProgress,
    onZoomChange,
    onToggleControls,
    onCloseLightbox,
    onInteractionStart,
    onInteractionEnd,
  });

  const heartPopAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartPopScale.value }],
    opacity: heartPopOpacity.value,
  }));

  const imageZoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const thumbnailUri = typeof item === 'object' && item.uri ? item.uri : (typeof item === 'string' ? item : null);
  const fullUri = typeof item === 'object' && item.fullUri ? item.fullUri : thumbnailUri;

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={{ width, height: '100%', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Animated.View style={[styles.lightboxImageStack, imageZoomAnimatedStyle]}>
          {/* Layer 1: Instant grid thumbnail from memory cache */}
          {thumbnailUri && (
            <Image
              source={{ uri: thumbnailUri }}
              style={[styles.lightboxImage, StyleSheet.absoluteFillObject]}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
            />
          )}
          {/* Layer 2: High-res image fading in smoothly on top */}
          {fullUri && fullUri !== thumbnailUri && (
            <Image
              source={{ uri: fullUri }}
              style={styles.lightboxImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              priority="high"
              transition={400}
            />
          )}
          {/* Layer 3: Heart Pop Center Animation Overlay */}
          <Animated.View 
            style={[
              styles.heartPopContainer, 
              heartPopAnimatedStyle
            ]} 
            pointerEvents="none"
          >
            <Ionicons name="heart" size={80} color="rgba(255, 255, 255, 0.75)" style={styles.heartPopShadow} />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  lightboxImageStack: {
    width: defaultScreenWidth,
    height: '82%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: defaultScreenWidth,
    height: '100%',
  },
  heartPopContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartPopShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
});
