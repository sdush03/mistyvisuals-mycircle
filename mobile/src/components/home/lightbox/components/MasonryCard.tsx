import React, { useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Image } from 'expo-image';

export interface MasonryCardProps {
  img: any;
  index: number;
  isColumn0: boolean;
  onSelect: (bounds: { x: number; y: number; width: number; height: number } | null) => void;
  onRegisterRef?: (cardId: string, ref: View | null) => void;
}

export const MasonryCard = React.memo(function MasonryCard({ 
  img, index, isColumn0, onSelect, onRegisterRef 
}: MasonryCardProps) {
  const cardRef = useRef<View>(null);
  const cardId = img.id || img.uri || `idx-${index}`;
  const primaryUri = typeof img === 'object' && img.uri ? img.uri : (typeof img === 'string' ? img : '');
  const fallbackUri = typeof img === 'object' && img.fullUri ? img.fullUri : '';
  const blurUri = typeof img === 'object' && img.blurUri ? img.blurUri : null;
  const [currentUri, setCurrentUri] = useState<string>(primaryUri);

  React.useEffect(() => { setCurrentUri(primaryUri); }, [primaryUri]);

  const cardAspect = (typeof img === 'object' && img.cardAspect)
    ? img.cardAspect
    : ((typeof img === 'object' && img.aspectRatio && !isNaN(img.aspectRatio) && img.aspectRatio > 0)
      ? img.aspectRatio
      : ((index + (isColumn0 ? 0 : 1)) % 3 === 0 ? 0.67 : ((index + (isColumn0 ? 0 : 1)) % 3 === 1 ? 0.75 : 0.80)));

  const handlePress = useCallback(() => {
    if (cardRef.current) {
      cardRef.current.measureInWindow((x, y, width, height) => {
        onSelect({ x, y, width, height });
      });
    } else {
      onSelect(null);
    }
  }, [onSelect]);

  return (
    <Pressable 
      ref={(ref) => {
        (cardRef as any).current = ref;
        if (onRegisterRef) onRegisterRef(cardId, ref);
      }} 
      style={[cardStyles.masonryCard, { aspectRatio: cardAspect }]} 
      onPress={handlePress}
    >
      {currentUri ? (
        <Image
          source={{ uri: currentUri }}
          style={cardStyles.masonryImage}
          contentFit="cover"
          priority="normal"
          cachePolicy="memory-disk"
          placeholder={blurUri ? { uri: blurUri } : undefined}
          placeholderContentFit="cover"
          transition={blurUri ? 200 : 0}
          onError={() => { if (fallbackUri && currentUri !== fallbackUri) setCurrentUri(fallbackUri); }}
        />
      ) : null}
    </Pressable>
  );
});

const cardStyles = StyleSheet.create({
  masonryCard: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  masonryImage: {
    width: '100%',
    height: '100%',
  },
});
