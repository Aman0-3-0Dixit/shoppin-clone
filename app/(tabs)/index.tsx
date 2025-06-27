/* eslint-disable react-native/no-inline-styles */
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
  Modal,
  ScrollView,
} from 'react-native';
import { DimensionValue } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons, Feather } from '@expo/vector-icons';
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

const getNumColumns = (w: number) => {
  if (w >= 1600) return 5;   // ≥ 1600 px  →  5 cards/row
  if (w >= 1200) return 4;   // ≥ 1200 px  →  4 cards/row
  if (w >= 900)  return 3;   // ≥ 900 px   →  3 cards/row
  if (w >= 700)  return 2;   // ≥ 700 px   →  2 cards/row
  return 1;                  // anything below → single-column
};

/* encode URL-form fields (skips undefined) */
const toUrlEncoded = (obj: Record<string, any>) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) =>
        encodeURIComponent(k) + '=' + encodeURIComponent(String(v)),
    )
    .join('&');

/* price presets */
const PRICE_PRESETS = [
  { label: 'Rs. 0 to Rs. 1 000', min: 0, max: 1000 },
  { label: 'Rs. 1 000 to Rs. 2 500', min: 1000, max: 2500 },
  { label: 'Rs. 2 500 to Rs. 5 000', min: 2500, max: 5000 },
  { label: 'Rs. 5 000 to Rs. 10 000', min: 5000, max: 10000 },
  { label: 'Rs. 10 000+', min: 10000, max: 1000000 },
];

/* ───────────── Main component ─────────── */
export default function SearchTab() {
  /* basic query/image state */
  const [query, setQuery] = useState('');
  const [picked, setPicked] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  /* filter state */
  const [filterVisible, setFilterVisible] = useState(false);
  const [brandInput, setBrandInput] = useState('');
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<number | undefined>();
  const [priceMax, setPriceMax] = useState<number | undefined>();

  /* results & ui state */
  const [rawResults, setRawResults] = useState<Product[]>([]);
  const [visible, setVisible] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSearchId = useRef<string | undefined>(undefined);

  /* responsive columns */
  const { width } = useWindowDimensions();
  const [numColumns, setNumColumns] = useState(() => getNumColumns(width));
  useEffect(() => setNumColumns(getNumColumns(width)), [width]);

  /* ---------------- core helpers --------------- */
  const wipe = () => {
    setRawResults([]);
    setVisible([]);
    lastSearchId.current = uuidv4();
  };

  const appendJson = (json: any) => {
    if (json?.search_id) lastSearchId.current = json.search_id;
    setRawResults((p) => [...p, ...(json?.data ?? [])]);
    setVisible((p) => [...p, ...(json?.data ?? [])]);
  };

  /* -------------- build filter fields --------- */
  const filterFields = {
    ...(selectedBrands.length && {
      brand: JSON.stringify(selectedBrands),
    }),
    ...(priceMin !== undefined && { price_min: priceMin }),
    ...(priceMax !== undefined && { price_max: priceMax }),
  };

  /* -------------- POST wrappers --------------- */
  const postEncoded = async (bodyObj: Record<string, any>) => {
    const body = toUrlEncoded(bodyObj);
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        client: 'web',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  };

  const postMultipart = async (fd: FormData) =>
    fetch(ENDPOINT, { method: 'POST', headers: { client: 'web' }, body: fd });

  /* -------------- text search ----------------- */
  const fetchText = async (offset = 0) => {
    if (!query.trim()) return;
    if (offset === 0) wipe();

    try {
      setLoading(true);
      setError(null);
      const res = await postEncoded({
        search_type: 'text_search',
        query: query.trim(),
        offset,
        limit: PAGE_SIZE,
        search_id: lastSearchId.current,
        ...filterFields,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      appendJson(await res.json());
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  /* -------------- image search ---------------- */
  const fetchImage = async (
    asset: ImagePicker.ImagePickerAsset,
    offset = 0,
  ) => {
    if (!asset) return;
    if (offset === 0) wipe();

    try {
      setLoading(true);
      setError(null);
      const blob = await (await fetch(asset.uri)).blob();
      const fd = new FormData();
      fd.append('search_type', 'image_search');
      fd.append('offset', String(offset));
      fd.append('limit', String(PAGE_SIZE));
      fd.append(
        'coordinates',
        JSON.stringify({ x: 5, y: 5, width: 90, height: 90 }),
      );
      fd.append('search_id', lastSearchId.current as string);
      Object.entries(filterFields).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append('file', blob as any, 'img.jpg');

      const res = await postMultipart(fd);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      appendJson(await res.json());
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  /* -------------- UI handlers ---------------- */
  const runTextSearch = () => fetchText(0);

  const debounced = useRef(debounce(runTextSearch, 500)).current;

  const handlePickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!res.canceled) {
      setPicked(res.assets[0]);
      fetchImage(res.assets[0], 0);
    }
  };

  const handleEndReached = () => {
    if (visible.length >= rawResults.length) return; // prevent duplicate
    if (picked) fetchImage(picked, rawResults.length);
    else fetchText(rawResults.length);
  };

  /* brand util */
  const addBrand = () => {
    const trimmed = brandInput.trim().toLowerCase();
    if (trimmed && !selectedBrands.includes(trimmed)) {
      setSelectedBrands([...selectedBrands, trimmed]);
    }
    setBrandInput('');
  };
  const removeBrand = (b: string) =>
    setSelectedBrands(selectedBrands.filter((x) => x !== b));

  /* ---------------- memo helpers -------------- */
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

  const hasActiveFilters = selectedBrands.length > 0 || priceMin !== undefined || priceMax !== undefined;

  /* ---------------- UI ----------------------- */
  return (
    <SafeAreaView style={styles.container}>
      {/* search row */}
      <View style={styles.searchWrapper}>
        <TextInput
          placeholder="Search…"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            // debounced(); // enable live search
          }}
          onSubmitEditing={runTextSearch}
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable onPress={handlePickImage} style={styles.iconBox}>
          <MaterialIcons name="photo-camera" size={24} color="#555" />
        </Pressable>
        <Pressable onPress={runTextSearch} style={styles.button}>
          <Text style={styles.buttonText}>Search</Text>
        </Pressable>
      </View>

      {/* filter icon row */}
<View style={styles.filterRow}>
  <Pressable
    onPress={() => setFilterVisible(true)}
    /* merge the extra style when active */
    style={[
      styles.filterIcon,
      hasActiveFilters && styles.filterIconActive,
    ]}
  >
    <Feather
      name="sliders"
      size={20}
      /* white when active, grey when not */
      color={hasActiveFilters ? '#fff' : '#444'}
    />
  </Pressable>
</View>

      {/* status */}
      {loading && (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {/* results */}
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

      {/* ---------- FILTER MODAL ---------- */}
      <Modal
        visible={filterVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFilterVisible(false)}
      >
        <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setFilterVisible(false)}
            />
          <View style={styles.modalCard}>
            <ScrollView>
              {/* brand section */}
              <Text style={styles.modalHeader}>Brand</Text>
              <View style={styles.brandRow}>
                <TextInput
                  placeholder="Add your brand"
                  style={styles.brandInput}
                  value={brandInput}
                  onChangeText={setBrandInput}
                  onSubmitEditing={addBrand}
                />
                <Pressable onPress={addBrand} style={styles.addBtn}>
                  <Text style={{ color: '#fff' }}>Add</Text>
                </Pressable>
              </View>
              <View style={styles.brandChipWrap}>
                {selectedBrands.map((b) => (
                  <View key={b} style={styles.chip}>
                    <Text style={{ marginRight: 4 }}>{b}</Text>
                    <Pressable onPress={() => removeBrand(b)}>
                      <Feather name="x" size={14} />
                    </Pressable>
                  </View>
                ))}
              </View>

              {/* price section */}
              <Text style={[styles.modalHeader, { marginTop: 16 }]}>
                Price
              </Text>
              {PRICE_PRESETS.map((p) => (
                <Pressable
                  key={p.label}
                  style={styles.radioRow}
                  onPress={() => {
                    setPriceMin(p.min);
                    setPriceMax(p.max);
                  }}
                >
                  <View style={styles.radioOuter}>
                    {priceMin === p.min && priceMax === p.max && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                  <Text>{p.label}</Text>
                </Pressable>
              ))}
              <View style={styles.customRow}>
                <TextInput
                  placeholder="Min"
                  keyboardType="numeric"
                  style={styles.customInput}
                  value={priceMin !== undefined ? String(priceMin) : ''}
                  onChangeText={(v) =>
                    setPriceMin(v ? Number(v) : undefined)
                  }
                />
                <Text style={{ marginHorizontal: 4 }}>–</Text>
                <TextInput
                  placeholder="Max"
                  keyboardType="numeric"
                  style={styles.customInput}
                  value={priceMax !== undefined ? String(priceMax) : ''}
                  onChangeText={(v) =>
                    setPriceMax(v ? Number(v) : undefined)
                  }
                />
              </View>
            </ScrollView>

            {/* modal actions */}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setSelectedBrands([]);
                  setPriceMin(undefined);
                  setPriceMax(undefined);
                }}
                style={[styles.actBtn, { backgroundColor: '#eee' }]}
              >
                <Text>Reset</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setFilterVisible(false);
                  // re-issue current search with filters
                  picked ? fetchImage(picked, 0) : fetchText(0);
                }}
                style={[styles.actBtn, { backgroundColor: '#ff5a5f' }]}
              >
                <Text style={{ color: '#fff' }}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ───────────── Card ───────────── */
interface CardProps {
  item: Product;
  numColumns: number;
}
const ProductCard = memo(({ item, numColumns }: CardProps) => {
  const cardWidth: DimensionValue = `${100 / numColumns - 2}%`;
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

/* ───────────── Styles ───────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  /* search */
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

  /* filter icon row */
  filterRow: { flexDirection: 'row', paddingLeft: 12, marginTop: 4 },
  filterIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f4f4f4',
    justifyContent: 'center',
    alignItems: 'center',
  },
    filterIconActive: {
    backgroundColor: '#000',
  },

  /* message */
  error: { color: 'crimson', textAlign: 'center', marginTop: 16 },

  /* list item */
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

  /* modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#0006',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    maxHeight: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalHeader: { fontSize: 16, fontWeight: '600', marginBottom: 8 },

  /* brand */
  brandRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  brandInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
  },
  addBtn: {
    backgroundColor: '#ff5a5f',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#eee',
    borderRadius: 16,
  },

  /* price */
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff5a5f',
  },
  customRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 36,
  },

  /* modal buttons */
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  actBtn: {
    flex: 1,
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
