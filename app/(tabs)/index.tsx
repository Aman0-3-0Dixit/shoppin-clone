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
  StyleSheet,
} from 'react-native';

import 'react-native-get-random-values';   // ← polyfill for older Android
import { v4 as uuidv4 } from 'uuid';
import { Image } from 'expo-image';
import debounce from 'lodash.debounce';

/* ───────── Types & constants ──────── */
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

/* ─────────────── Component ─────────────── */
export default function SearchTab() {
  const [query, setQuery] = useState('');
  const [rawResults, setRawResults] = useState<Product[]>([]);
  const [visible, setVisible] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const [numColumns, setNumColumns] = useState(() => getNumColumns(width));
  useEffect(() => setNumColumns(getNumColumns(width)), [width]);

  /* ---- search_id thread keeper ---- */
  const lastSearchId = useRef<string | undefined>(undefined);

  /* -------- network fetch ---------- */
  const fetchResults = async (q: string, offset = 0) => {
    if (!q.trim()) return;
    try {
      setLoading(true);
      setError(null);

      if (offset === 0) {
        setRawResults([]);
        setVisible([]);
      }

      const body = toUrlEncoded({
        search_type: 'text_search',
        query: q.trim(),
        offset,
        limit: PAGE_SIZE,
        search_id: lastSearchId.current!,   // always defined
      });

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          client: 'web',
        },
        body,
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      const data: Product[] = json?.data ?? [];

      setRawResults((prev) => [...prev, ...data]);
      setVisible((prev) => [...prev, ...data]);
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  /* -------- handlers & memo -------- */
  const searchHandler = () => {
    lastSearchId.current = uuidv4();   // 🔑 new UUID each search
    fetchResults(query, 0);
  };

  const debounced = useRef(
    debounce((t: string) => {
      lastSearchId.current = uuidv4();
      fetchResults(t, 0);
    }, 500),
  ).current;

  const handleChangeText = (text: string) => {
    setQuery(text);
    // debounced(text);   // enable for live search
  };

  const handleEndReached = () => {
    if (visible.length >= rawResults.length) return;
    fetchResults(query, rawResults.length);
  };

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

  /* ---------------- UI --------------- */
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchWrapper}>
        <TextInput
          placeholder="Search for skirts, tops, shoes…"
          value={query}
          onChangeText={handleChangeText}
          onSubmitEditing={searchHandler}
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable onPress={searchHandler} style={styles.button}>
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

/* ---------- Card component ---------- */
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

/* ------------ styles ------------- */
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
