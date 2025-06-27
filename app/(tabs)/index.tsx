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
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { DimensionValue } from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons, Feather, AntDesign } from '@expo/vector-icons';
import { Image } from 'expo-image';
import debounce from 'lodash.debounce';

/* ───────── Types & constants ───────── */
interface Product {
  id: number;
  image: string;
  brand_name?: string;
  title: string;
  price: string;
  discounted_price?: string | null;
  description?: string;
  link?: string;
  primary_images?: string[];
  variant_value_1?: string; // size
  variant_value_2?: string; // colour
  color_text_hash?: string;
}

const SEARCH_ENDPOINT =
  'https://backend.staging.shoppin.app/shopix/api/v2/search';
const DETAIL_ENDPOINT =
  'https://backend.staging.shoppin.app/shopix/api/v2/search_product_by_uid';
const SIMILAR_ENDPOINT =
  'https://backend.staging.shoppin.app/shopix/api/v2/search_similar_products';

const PAGE_SIZE = 20;

/* responsive breakpoints → 1–5 columns */
const getNumColumns = (w: number) => {
  if (w >= 1600) return 5;
  if (w >= 1200) return 4;
  if (w >= 900) return 3;
  if (w >= 700) return 2;
  return 1;
};

/* URL-encode helper */
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
  { label: 'Rs. 0 to Rs. 1 000', min: 0, max: 1_000 },
  { label: 'Rs. 1 000 to Rs. 2 500', min: 1_000, max: 2_500 },
  { label: 'Rs. 2 500 to Rs. 5 000', min: 2_500, max: 5_000 },
  { label: 'Rs. 5 000 to Rs. 10 000', min: 5_000, max: 10_000 },
  { label: 'Rs. 10 000+', min: 10_000, max: 1_000_000 },
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

  /* detail modal state */
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailImgIdx, setDetailImgIdx] = useState(0);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);

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
    return fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        client: 'web',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  };

  const postMultipart = async (fd: FormData) =>
    fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { client: 'web' },
      body: fd,
    });

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
      if (!res.ok) throw new Error(res.statusText);
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
      Object.entries(filterFields).forEach(([k, v]) =>
        fd.append(k, String(v)),
      );
      fd.append('file', blob as any, 'img.jpg');

      const res = await postMultipart(fd);
      if (!res.ok) throw new Error(res.statusText);
      appendJson(await res.json());
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  /* -------------- detail + similar fetch ------ */
  const openDetail = async (hash: string) => {
    try {
      setLoading(true);
      setError(null);

      /* 1️⃣ primary product */
      const det = await fetch(DETAIL_ENDPOINT, {
        method: 'POST',
        headers: { client: 'web', 'Content-Type': 'application/json' },
        body: JSON.stringify({ color_hashes: [hash] }),
      });
      if (!det.ok) throw new Error(det.statusText);
      const detJson = await det.json();
      const first: Product | undefined = detJson?.data?.[0];
      if (first) {
        setDetailProduct(first);
        setDetailImgIdx(0);
      }

      /* 2️⃣ similar products */
      const sim = await fetch(SIMILAR_ENDPOINT, {
        method: 'POST',
        headers: { client: 'web', 'Content-Type': 'application/json' },
        body: JSON.stringify({ color_text_hash: hash }),
      });
      if (!sim.ok) throw new Error(sim.statusText);
      const simJson = await sim.json();
      setSimilarProducts(simJson?.similar_product_results ?? []);
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
    if (visible.length >= rawResults.length) return;
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

  /* memo helpers */
  const keyExtractor = useCallback(
    (item: Product) => String(item.id),
    [],
  );
  const renderItem = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard
        item={item}
        numColumns={numColumns}
        onSelectHash={openDetail}
      />
    ),
    [numColumns],
  );

  /* filter-icon active state */
  const hasActiveFilters =
    selectedBrands.length > 0 ||
    priceMin !== undefined ||
    priceMax !== undefined;

  /* ---------------- UI ----------------------- */
  return (
    <SafeAreaView style={styles.container}>
      {/* search bar */}
      <View style={styles.searchWrapper}>
        <TextInput
          placeholder="Search…"
          value={query}
          onChangeText={setQuery}
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

      {/* filter icon */}
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setFilterVisible(true)}
          style={[
            styles.filterIcon,
            hasActiveFilters && styles.filterIconActive,
          ]}
        >
          <Feather
            name="sliders"
            size={20}
            color={hasActiveFilters ? '#fff' : '#444'}
          />
        </Pressable>
      </View>

      {/* status */}
      {loading && (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {/* results grid */}
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

      {/* ----------- FILTER MODAL ---------- */}
      {filterVisible && (
        <FilterModal
          visible={filterVisible}
          onClose={() => setFilterVisible(false)}
          brandInput={brandInput}
          setBrandInput={setBrandInput}
          selectedBrands={selectedBrands}
          addBrand={addBrand}
          removeBrand={removeBrand}
          priceMin={priceMin}
          priceMax={priceMax}
          setPriceMin={setPriceMin}
          setPriceMax={setPriceMax}
          reset={() => {
            setSelectedBrands([]);
            setPriceMin(undefined);
            setPriceMax(undefined);
          }}
          apply={() => {
            setFilterVisible(false);
            picked ? fetchImage(picked, 0) : fetchText(0);
          }}
        />
      )}

      {/* ----------- PRODUCT DETAIL MODAL -------- */}
      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          imgIdx={detailImgIdx}
          setImgIdx={setDetailImgIdx}
          similar={similarProducts}
          openDetail={openDetail}
          onClose={() => setDetailProduct(null)}
        />
      )}
    </SafeAreaView>
  );
}

/* ─────────── Product Card (grid) ─────────── */
interface CardProps {
  item: Product;
  numColumns: number;
  onSelectHash: (hash: string) => void;
}
const ProductCard = memo(
  ({ item, numColumns, onSelectHash }: CardProps) => {
    const cardWidth: DimensionValue = `${100 / numColumns - 2}%`;

    return (
      <Pressable
        onPress={() =>
          item.color_text_hash && onSelectHash(item.color_text_hash)
        }
        style={({ hovered }) => [
          styles.card,
          { width: cardWidth },
          hovered && ({ opacity: 0.7, cursor: 'pointer' } as any),
        ]}
      >
        <Image
          source={{ uri: item.image }}
          style={styles.image}
          contentFit="cover"
          transition={250}
        />
        <View style={styles.textSection}>
          {!!item.brand_name && (
            <Text style={styles.brand}>{item.brand_name}</Text>
          )}
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.price}>
            ₹ {item.discounted_price ?? item.price}
          </Text>
        </View>
      </Pressable>
    );
  },
);

/* ─────────── Filter Modal (unchanged) ─────────── */
interface FMProps {
  visible: boolean;
  onClose: () => void;
  brandInput: string;
  setBrandInput: (s: string) => void;
  selectedBrands: string[];
  addBrand: () => void;
  removeBrand: (b: string) => void;
  priceMin: number | undefined;
  priceMax: number | undefined;
  setPriceMin: (v: number | undefined) => void;
  setPriceMax: (v: number | undefined) => void;
  reset: () => void;
  apply: () => void;
}
const FilterModal = ({
  visible,
  onClose,
  brandInput,
  setBrandInput,
  selectedBrands,
  addBrand,
  removeBrand,
  priceMin,
  priceMax,
  setPriceMin,
  setPriceMax,
  reset,
  apply,
}: FMProps) => (
  <Modal visible={visible} animationType="slide" transparent>
    <View style={styles.modalBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.modalCard}>
        <ScrollView>
          {/* brand */}
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

          {/* price */}
          <Text style={[styles.modalHeader, { marginTop: 16 }]}>Price</Text>
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

        {/* actions */}
        <View style={styles.modalActions}>
          <Pressable
            onPress={reset}
            style={[styles.actBtn, { backgroundColor: '#eee' }]}
          >
            <Text>Reset</Text>
          </Pressable>
          <Pressable
            onPress={apply}
            style={[styles.actBtn, { backgroundColor: '#ff5a5f' }]}
          >
            <Text style={{ color: '#fff' }}>Apply</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
);

/* ─────────── Product Detail Modal ─────────── */
interface DMProps {
  product: Product;
  imgIdx: number;
  setImgIdx: (i: number) => void;
  similar: Product[];
  openDetail: (hash: string) => void;
  onClose: () => void;
}
const ProductDetailModal = ({
  product,
  imgIdx,
  setImgIdx,
  similar,
  openDetail,
  onClose,
}: DMProps) => {
  const images =
    product.primary_images?.length > 0
      ? product.primary_images
      : [product.image];

  const discount =
    product.price && product.discounted_price
      ? Math.round(
          ((Number(product.price.replace(/,/g, '')) -
            Number(product.discounted_price.replace(/,/g, ''))) /
            Number(product.price.replace(/,/g, ''))) *
            100,
        )
      : null;

  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const simColumns = getNumColumns(width);

  return (
    <Modal visible animationType="slide">
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* close */}
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}
        >
          <AntDesign name="closecircle" size={28} color="#444" />
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View
            style={[
              { padding: 16 },
              isWide && { flexDirection: 'row', gap: 16 },
            ]}
          >
            {/* thumbnails */}
            {isWide && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {images.map((uri, idx) => (
                  <Pressable
                    key={uri}
                    onPress={() => setImgIdx(idx)}
                    style={[
                      {
                        marginBottom: 8,
                        borderWidth: 2,
                        borderColor: 'transparent',
                      },
                      idx === imgIdx && { borderColor: '#ff5a5f' },
                    ]}
                  >
                    <Image
                      source={{ uri }}
                      style={{ width: 60, height: 90 }}
                      contentFit="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* hero image */}
            <Image
              source={{ uri: images[imgIdx] }}
              style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: 8 }}
              contentFit="cover"
            />

            {/* info */}
            <View style={[{ flex: 1 }, isWide && { paddingLeft: 24 }]}>
              <Text style={{ fontSize: 20, fontWeight: '700', marginTop: 8 }}>
                {product.brand_name}
              </Text>
              <Text
                style={{ fontSize: 18, fontWeight: '500', color: '#555' }}
              >
                {product.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={{
                    fontSize: 24,
                    fontWeight: '700',
                    marginRight: 8,
                  }}
                >
                  ₹ {product.discounted_price ?? product.price}
                </Text>
                {product.discounted_price && (
                  <Text
                    style={{
                      textDecorationLine: 'line-through',
                      color: '#999',
                      marginRight: 6,
                    }}
                  >
                    ₹ {product.price}
                  </Text>
                )}
                {discount !== null && (
                  <Text style={{ color: 'green', fontWeight: '600' }}>
                    ({discount}% off)
                  </Text>
                )}
              </View>

              {/* size chips if present */}
              {!!product.variant_value_1 && (
                <>
                  <Text
                    style={{
                      fontWeight: '600',
                      marginTop: 16,
                      marginBottom: 4,
                    }}
                  >
                    size
                  </Text>
                  <Pressable style={styles.sizeChip}>
                    <Text>{product.variant_value_1}</Text>
                  </Pressable>
                </>
              )}

              {/* CTA button */}
              <Pressable
                onPress={() => {
                  if (product.link) Linking.openURL(product.link);
                }}
                style={styles.shopBtn}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>
                  Shop Now
                </Text>
              </Pressable>

              {/* description */}
              {!!product.description && (
                <Text style={{ marginTop: 12, lineHeight: 20 }}>
                  {product.description}
                </Text>
              )}
            </View>
          </View>

          {/* similar products */}
          {similar.length > 0 && (
            <>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '600',
                  marginLeft: 16,
                  marginBottom: 8,
                }}
              >
                Similar products
              </Text>
              <FlatList
                data={similar}
                key={simColumns}
                numColumns={simColumns}
                renderItem={({ item }) => (
                  <ProductCard
                    item={item}
                    numColumns={simColumns}
                    onSelectHash={openDetail}
                  />
                )}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                columnWrapperStyle={simColumns > 1 && { gap: 12 }}
                scrollEnabled={false}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

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

  /* filter icon */
  filterRow: { flexDirection: 'row', paddingLeft: 12, marginTop: 4 },
  filterIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f4f4f4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterIconActive: { backgroundColor: '#000' },

  /* message */
  error: { color: 'crimson', textAlign: 'center', marginTop: 16 },

  /* card */
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

  /* modal backdrop + card */
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

  /* brand chip & row */
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

  /* price radios */
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

  /* product detail */
  sizeChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
  },
  shopBtn: {
    marginTop: 12,
    backgroundColor: '#ff5a5f',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});




