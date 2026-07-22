import React from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Modal, 
  ScrollView, 
  Image, 
  Pressable,
  StatusBar,
  Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT_MONTSERRAT_REGULAR } from '../../constants/fonts';

const { height: screenHeight } = Dimensions.get('screen');

interface Article {
  id: string;
  title: string;
  category: string;
  date: string;
  readTime: string;
  coverImage: any;
  content: string[];
}

interface ArticleViewProps {
  isOpen: boolean;
  onClose: () => void;
  article: Article | null;
}

const formatDateText = (rawDate?: string): string => {
  if (!rawDate) return '';
  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (months[monthIndex]) {
      return `${months[monthIndex]} ${day}, ${year}`;
    }
  }

  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
  }

  return rawDate;
};

export default function ArticleView({ isOpen, onClose, article }: ArticleViewProps) {
  const insets = useSafeAreaInsets();
  if (!article) return null;

  const categoryText = (article.category || '').toUpperCase();
  const titleText = article.title || '';
  const dateText = formatDateText(article.date);
  const readTimeText = article.readTime || '';
  const contentParagraphs = Array.isArray(article.content) ? article.content : [];

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        {/* Borderless Editorial Back Button */}
        <Pressable 
          style={[styles.editorialBackButton, { top: Math.max(insets.top + 16, 48) }]} 
          onPress={onClose}
          hitSlop={16}
        >
          <Text style={styles.editorialBackIcon}>←</Text>
          <Text style={styles.editorialBackText}>BACK</Text>
        </Pressable>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Cover Image */}
          <View style={styles.coverContainer}>
            <Image source={article.coverImage} style={styles.coverImage} />
            <View style={styles.coverOverlay} />
          </View>

          {/* Article Header Metadata */}
          <View style={styles.metaContainer}>
            {categoryText ? <Text style={styles.articleCategory}>{categoryText}</Text> : null}
            {titleText ? <Text style={styles.articleTitle}>{titleText}</Text> : null}
            <View style={styles.metaRow}>
              {dateText ? <Text style={styles.metaText}>{dateText}</Text> : null}
              <Text style={styles.metaDivider}>•</Text>
              {readTimeText ? <Text style={styles.metaText}>{readTimeText}</Text> : null}
              <Text style={styles.metaDivider}>•</Text>
              <Text style={styles.metaText}>By Misty Visuals</Text>
            </View>
            <View style={styles.lineDivider} />
          </View>

          {/* Body Content */}
          <View style={styles.bodyContainer}>
            {contentParagraphs.map((paragraph, index) => {
              const isFirst = index === 0;
              return (
                <Text 
                  key={index} 
                  style={[
                    styles.bodyParagraph, 
                    isFirst && styles.firstParagraph
                  ]}
                >
                  {paragraph}
                </Text>
              );
            })}
          </View>

          {/* Editorial Footer */}
          <View style={styles.footerContainer}>
            <View style={styles.footerDivider} />
            <Text style={styles.footerBrand}>MISTY VISUALS</Text>
            <Text style={styles.footerTagline}>FINE ART WEDDING PHOTOGRAPHY & FILMS</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  editorialBackButton: {
    position: 'absolute',
    left: 24,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  editorialBackIcon: {
    color: '#ffffff',
    fontSize: 19,
    lineHeight: 19,
    marginRight: 3,
    transform: [{ translateY: -3.5 }],
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  editorialBackText: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 3,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  coverContainer: {
    width: '100%',
    height: Math.round(screenHeight * 0.70),
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.15)', // Gradient/tint overlay for close button contrast
  },
  metaContainer: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  articleCategory: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#8c867e',
    marginBottom: 12,
  },
  articleTitle: {
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '300',
    color: '#1c1a18',
    lineHeight: 34,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  metaText: {
    fontSize: 11,
    color: '#8c867e',
    letterSpacing: 0.5,
  },
  metaDivider: {
    fontSize: 11,
    color: '#ddd8d0',
    marginHorizontal: 8,
  },
  lineDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#f0ede8',
  },
  bodyContainer: {
    paddingHorizontal: 24,
  },
  bodyParagraph: {
    fontFamily: 'serif',
    fontSize: 15,
    lineHeight: 27,
    color: '#3a3630',
    marginBottom: 20,
    textAlign: 'justify',
  },
  firstParagraph: {
    fontSize: 17,
    lineHeight: 30,
    color: '#1c1a18',
  },
  footerContainer: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  footerDivider: {
    width: 60,
    height: 1,
    backgroundColor: '#ddd8d0',
    marginBottom: 24,
  },
  footerBrand: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#1c1a18',
    marginBottom: 6,
  },
  footerTagline: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#8c867e',
  },
});
