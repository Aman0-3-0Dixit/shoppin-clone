import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
} from 'react';
import {
  SafeAreaView,
  View,
  TextInput,
  Pressable,
  Text,
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
  Platform,
  Image as RNImage,
  StyleSheet,
} from 'react-native';

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import debounce from 'lodash.debounce';

/* ───────── Constants & helpers ───────── */
interface Product {
  id: number;
  image: string;
  brand_name?: string;
  title: string;
  price: string;
  discounted_price?: string | null;
}

const ENDPOINT =
  'https://backend.staging.shoppin.app/shopix/api/v2/search';
const PAGE_SIZE = 20;
const getNumColumns = (w: number) => (w > 700 ? 2 : 1);

const toUrlEncoded = (obj: Record<string, any>) =>
  Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(
      ([k, v]) =>
        encodeURIComponent(k) + '=' + encodeURIComponent(String(v)),
    )
    .join('&');

/* ───────────── Main component ─────────── */
export default function SearchTab() {
  const [query, setQuery] = useState('');
  const [rawResults, setRawResults] = useState<Product[]>([]);
  const [visible, setVisible] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSearchId = useRef<string | undefined>(undefined);

  /* responsive columns */
  const { width } = useWindowDimensions();
  const [numColumns, setNumColumns] = useState(() => getNumColumns(width));
  useEffect(() => setNumColumns(getNumColumns(width)), [width]);

  /* ---------------- Networkers ---------------- */
  const handleJson = (json: any) => {
    if (json?.search_id) lastSearchId.current = json.search_id;
    const data: Product[] = json?.data ?? [];
    setRawResults((prev) => [...prev, ...data]);
    setVisible((prev) => [...prev, ...data]);
  };

  /** Shared pre-work for a new thread */
  const wipeAndSeed = () => {
    setRawResults([]);
    setVisible([]);
    lastSearchId.current = uuidv4();
  };

  const fetchText = async (offset = 0) => {
    if (!query.trim()) return;
    if (offset === 0) wipeAndSeed();

    const body = toUrlEncoded({
      search_type: 'text_search',
      query: query.trim(),
      offset,
      limit: PAGE_SIZE,
      search_id: lastSearchId.current,
    });

    await post(body, true, offset === 0);
  };

  const fetchImage = async (
    asset: ImagePicker.ImagePickerAsset,
    offset = 0,
  ) => {
    if (offset === 0) wipeAndSeed();

    const blob = await (await fetch(asset.uri)).blob();
    const fd = new FormData();
    fd.append('search_type', 'image_search');
    fd.append('offset', String(offset));
    fd.append('limit', String(PAGE_SIZE));
    fd.append(
      'coordinates',
      JSON.stringify({ x: 5, y: 5, width: 90, height: 90 }),
    ); // full frame
    fd.append('search_id', lastSearchId.current as string);
    fd.append('file', blob as any, 'photo.jpg');

    await post(fd, false, offset === 0);
  };

  const post = async (
    body: any,
    isFormUrlEncoded: boolean,
    clearError = false,
  ) => {
    try {
      setLoading(true);
      if (clearError) setError(null);

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          client: 'web',
          ...(isFormUrlEncoded && {
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
        body,
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      handleJson(await res.json());
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Handlers -------------- */
  const runTextSearch = () => fetchText(0);

  const debounced = useRef(
    debounce(() => fetchText(0), 500),
  ).current;

  const handleEndReached = () => {
    if (visible.length >= rawResults.length) return;
    fetchText(rawResults.length);
  };

  const pickAndSearchImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!res.canceled) fetchImage(res.assets[0], 0);
  };

  /* ---------------- Memo helpers ---------- */
  const keyExtractor = useCallback(
    (item: Product) => String(item.id),
    [],
  );
  const renderItem = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard item={item} numColumns={numColumns} />
    ),
    [numColumns],
  );

  /* ---------------- UI -------------------- */
  return (
    <SafeAreaView style={styles.container}>
      {/* search bar row */}
      <View style={styles.searchWrapper}>
        <TextInput
          placeholder="Search for skirts, tops, shoes…"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            // debounced(); // enable live search
          }}
          onSubmitEditing={runTextSearch}
          style={styles.input}
          returnKeyType="search"
        />

        {/* Camera icon */}
        <Pressable onPress={pickAndSearchImage} style={styles.iconBox}>
          <MaterialIcons name="photo-camera" size={24} color="#555" />
        </Pressable>

        {/* text search button */}
        <Pressable onPress={runTextSearch} style={styles.button}>
          <Text style={styles.buttonText}>Search</Text>
        </Pressable>
      </View>

      {loading && (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        key={numColumns}
        numColumns={numColumns}
        data={visible}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={{ padding: 12 }}
        columnWrapperStyle={numColumns > 1 && { gap: 12 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews={Platform.OS !== 'web'}
      />
    </SafeAreaView>
  );
}

/* ───────────── Product Card ───────────── */
interface CardProps {
  item: Product;
  numColumns: number;
}
const ProductCard = memo(({ item, numColumns }: CardProps) => {
  const cardWidth = numColumns === 1 ? '100%' : '48%';
  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <Image
        source={{ uri: item.image }}
        style={styles.image}
        contentFit="cover"
        transition={250}
      />
      <View style={styles.textSection}>
        {item.brand_name && (
          <Text style={styles.brand}>{item.brand_name}</Text>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.price}>
          ₹ {item.discounted_price ?? item.price}
        </Text>
      </View>
    </View>
  );
});

/* ─────────────── Styles ─────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  searchWrapper: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 16,
  },
  iconBox: {
    paddingHorizontal: 6,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#ff5a5f',
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },

  error: { color: 'crimson', textAlign: 'center', marginTop: 16 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  image: { width: '100%', aspectRatio: 3 / 4 },
  textSection: { padding: 10 },
  brand: { fontSize: 12, color: '#888', textTransform: 'capitalize' },
  title: { fontSize: 14, fontWeight: '500', marginVertical: 2 },
  price: { fontSize: 16, fontWeight: '700' },
});