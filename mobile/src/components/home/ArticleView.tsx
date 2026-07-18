import React from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  Modal, 
  ScrollView, 
  Image, 
  Pressable, 
  SafeAreaView 
} from 'react-native';

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

export default function ArticleView({ isOpen, onClose, article }: ArticleViewProps) {
  if (!article) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <SafeAreaView style={styles.header}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>✕ CLOSE</Text>
          </Pressable>
          <Text style={styles.headerTitle}>CIRCLE JOURNAL</Text>
          <View style={{ width: 60 }} /> {/* Spacer for centering */}
        </SafeAreaView>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Cover Image */}
          <View style={styles.coverContainer}>
            <Image source={article.coverImage} style={styles.coverImage} />
            <View style={styles.coverOverlay} />
          </View>

          {/* Article Header Metadata */}
          <View style={styles.metaContainer}>
            <Text style={styles.articleCategory}>{article.category.toUpperCase()}</Text>
            <Text style={styles.articleTitle}>{article.title}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{article.date}</Text>
              <Text style={styles.metaDivider}>•</Text>
              <Text style={styles.metaText}>{article.readTime}</Text>
              <Text style={styles.metaDivider}>•</Text>
              <Text style={styles.metaText}>By Misty Visuals</Text>
            </View>
            <View style={styles.lineDivider} />
          </View>

          {/* Body Content */}
          <View style={styles.bodyContainer}>
            {article.content.map((paragraph, index) => {
              // Highlight the first paragraph with larger font (drop cap/editorial style)
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0ede8',
    backgroundColor: '#ffffff',
  },
  closeButton: {
    paddingVertical: 12,
  },
  closeText: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#8c867e',
  },
  headerTitle: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#1c1a18',
    textAlign: 'center',
  },
  scrollContent: {
    paddingBottom: 60,
  },
  coverContainer: {
    width: '100%',
    height: 260,
    backgroundColor: '#f5f5f5',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.03)', // Subtle tint
  },
  metaContainer: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  articleCategory: {
    fontFamily: 'System',
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
    fontFamily: 'System',
    fontSize: 11,
    color: '#8c867e',
    letterSpacing: 0.5,
  },
  metaDivider: {
    fontFamily: 'System',
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
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 4,
    color: '#1c1a18',
    marginBottom: 6,
  },
  footerTagline: {
    fontFamily: 'System',
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 2,
    color: '#8c867e',
  },
});
