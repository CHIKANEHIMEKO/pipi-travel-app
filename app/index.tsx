import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Camera,
  Check,
  Clock,
  Edit3,
  ExternalLink,
  Heart,
  Info,
  Lock,
  MapPin,
  Navigation,
  Plane,
  Plus,
  Store,
  Trash2,
  Utensils,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// 從環境變數讀取
const API_URL = process.env.EXPO_PUBLIC_API_URL || '';
const MY_LIST = process.env.EXPO_PUBLIC_MAPS_LIST_URL || '';

// --- 型別定義 ---
interface ItineraryItem {
  id: string;
  time: string;
  title: string;
  note: string;
  type: string;
  mapsUrl: string;
  titleEmoji?: string;
  itemType?: 'TABS' | 'SUMMARY' | 'REAL_ITEM';
  isDummy?: boolean;
}

interface DayPlan {
  day: number;
  summary: string;
  items: ItineraryItem[];
}

const { width } = Dimensions.get('window');

// ✅ 產生穩定的 unique id（避免 new- 前綴造成誤判）
const genId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ✅ 新增：標準化時間格式 (確保 9:00 變成 09:00，並處理 ISO 字串)
const normalizeTime = (timeStr: string) => {
  if (!timeStr) return "12:00";
  
  let target = timeStr;
  // 如果是 ISO 格式 (1899-12-30T09:00:00.000Z)，取 T 後面的時間
  if (timeStr.includes('T')) {
    target = timeStr.split('T')[1].substring(0, 5);
  }
  
  // 確保是 HH:mm 格式並補零 (處理 9:00 -> 09:00)
  const parts = target.split(':');
  if (parts.length >= 2) {
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].substring(0, 2).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return target;
};

// --- 工具函式 ---
const renderTextWithLinks = (text: string) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <Text key={index} style={styles.linkText} onPress={() => Linking.openURL(part)}>
          {part}
        </Text>
      );
    }
    return <Text key={index}>{part}</Text>;
  });
};

// ✅ 修改：使用 normalizeTime 確保解析正確
const parseTimeToDate = (timeStr: string) => {
  const normalized = normalizeTime(timeStr);
  const [hours, minutes] = normalized.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0);
  date.setMinutes(minutes || 0);
  return date;
};

const formatDateToString = (date: Date) => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

// ✅ 修改：排序時先標準化，解決 17:00 排在 9:00 前的問題
const sortByTime = (items: ItineraryItem[]) => {
  return [...items].sort((a, b) => 
    normalizeTime(a.time).localeCompare(normalizeTime(b.time))
  );
};

const getTypeConfig = (type: string) => {
  switch (type) {
    case 'food':
      return { color: '#FFF7ED', textColor: '#EA580C', borderColor: '#FFEDD5', icon: Utensils };
    case 'sight':
      return { color: '#ECFDF5', textColor: '#059669', borderColor: '#D1FAE5', icon: Camera };
    case 'transport':
      return { color: '#EFF6FF', textColor: '#2563EB', borderColor: '#DBEAFE', icon: Plane };
    case 'hotel':
      return { color: '#F5F3FF', textColor: '#7C3AED', borderColor: '#EDE9FE', icon: MapPin };
    case 'shopping':
      return { color: '#FFF1F2', textColor: '#E11D48', borderColor: '#FFE4E6', icon: Store };
    default:
      return { color: '#F9FAFB', textColor: '#4B5563', borderColor: '#F3F4F6', icon: Info };
  }
};

// 判斷 mapsUrl 是否「真的有貼」
const hasMapsUrl = (item?: ItineraryItem | null) => {
  const url = (item?.mapsUrl || '').trim();
  return /^https?:\/\/\S+$/i.test(url);
};

/** -------------------------------
 * ✅ 優化後的工具函式：精準提取地點資訊
 * ------------------------------- */

const extractLatLngFromGoogleMapsUrl = (url?: string) => {
  if (!url) return null;
  // 匹配 !3d...!4d 或 @lat,lng
  const m1 = url.match(/!3d(-?\d+(\.\d+)?)!4d(-?\d+(\.\d+)?)/);
  if (m1) return `${m1[1]},${m1[3]}`;

  const m2 = url.match(/@(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/);
  if (m2) return `${m2[1]},${m2[3]}`;
  return null;
};

const extractPlaceNameFromGoogleMapsUrl = (url?: string) => {
  if (!url) return null;
  
  // 1. 嘗試從 /maps/place/名稱 提取
  const mPlace = url.match(/\/maps\/place\/([^\/|\?]+)/);
  if (mPlace) return decodeURIComponent(mPlace[1].replace(/\+/g, ' '));

  // 2. 嘗試從搜尋參數 q=名稱 提取 (常見於搜尋結果連結)
  const urlObj = new URL(url);
  const qParam = urlObj.searchParams.get('q');
  if (qParam) return qParam;

  return null;
};

/** -------------------------------
 * --- 子組件：路線連接器 ---
 * ✅ 解決「壽司」導航到台灣的問題
 * ------------------------------- */
const RouteConnector = ({ fromItem, toItem }: { fromItem: ItineraryItem; toItem: ItineraryItem }) => {
  const handleOpenRoute = () => {
    // 取得起點
    const fromLatLng = extractLatLngFromGoogleMapsUrl(fromItem.mapsUrl);
    const fromName = extractPlaceNameFromGoogleMapsUrl(fromItem.mapsUrl);
    // 如果只有名字，加上 "Nagoya" 確保搜尋範圍
    const from = fromLatLng || fromName || `${fromItem.title}, Nagoya`;

    // 取得終點
    const toLatLng = extractLatLngFromGoogleMapsUrl(toItem.mapsUrl);
    const toName = extractPlaceNameFromGoogleMapsUrl(toItem.mapsUrl);
    const to = toLatLng || toName || `${toItem.title}, Nagoya`;

    if (!from || !to) return;

    // ✅ 使用官方 Directions API 格式
    // origin: 起點, destination: 終點, travelmode: 交通方式
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      from
    )}&destination=${encodeURIComponent(to)}&travelmode=transit`;

    Linking.openURL(url);
  };

  return (
    <View style={styles.routeWrapper}>
      <View style={styles.routeLineContainer}>
        <View style={styles.fullVerticalLine} />
      </View>
      <TouchableOpacity style={styles.routePill} onPress={handleOpenRoute}>
        <Navigation size={12} color="#FF8FAB" strokeWidth={3} />
        <Text style={styles.routePillText}>路線規劃</Text>
        <ExternalLink size={10} color="#FF8FAB" />
      </TouchableOpacity>
    </View>
  );
};

// --- 子組件：行程卡片 ---
const ItineraryItemRow = ({ item, onEdit, onDelete, isFirst, isLast, isEditMode }: any) => {
  const config = getTypeConfig(item.type);
  const Icon = config.icon;

  // ✅ Web 防誤觸：拖拉/滑動時不要開啟編輯 modal
  const pressStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const movedRef = React.useRef(false);
  const swipingRef = React.useRef(false);
  const MOVE_THRESHOLD = 8;

  // ✅ Swipeable ref + 自動收回計時器
  const swipeRef = React.useRef<Swipeable | null>(null);
  const autoCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_CLOSE_MS = 2000;

  const clearAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };

  const startAutoCloseTimer = () => {
    clearAutoCloseTimer();
    autoCloseTimerRef.current = setTimeout(() => {
      swipeRef.current?.close();
    }, AUTO_CLOSE_MS);
  };

  const renderRightActions = () => {
    if (!isEditMode) return null;

    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => {
          clearAutoCloseTimer();
          swipeRef.current?.close();
          onDelete(item.id);
        }}
      >
        <Trash2 color="#FFF" size={24} />
        <Text style={styles.deleteActionText}>刪除</Text>
      </TouchableOpacity>
    );
  };

  const shouldIgnorePress = () => {
    if (Platform.OS !== 'web') return false;
    return movedRef.current || swipingRef.current;
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      enabled={isEditMode}
      overshootRight={false}
      rightThreshold={40}
      onSwipeableOpenStartDrag={() => {
        swipingRef.current = true;
      }}
      onSwipeableCloseStartDrag={() => {
        swipingRef.current = true;
      }}
      onSwipeableOpen={() => {
        swipingRef.current = false;
        startAutoCloseTimer();
      }}
      onSwipeableClose={() => {
        swipingRef.current = false;
        clearAutoCloseTimer();
      }}
    >
      <Pressable
        onPressIn={(e) => {
          pressStartRef.current = {
            x: e.nativeEvent.locationX,
            y: e.nativeEvent.locationY,
          };
          movedRef.current = false;
        }}
        onPressOut={(e) => {
          const start = pressStartRef.current;
          if (!start) return;

          const endX = e.nativeEvent.locationX;
          const endY = e.nativeEvent.locationY;

          const dx = Math.abs(endX - start.x);
          const dy = Math.abs(endY - start.y);

          if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
            movedRef.current = true;
          }
        }}
        onPress={() => {
          if (!isEditMode) return;
          if (shouldIgnorePress()) return;
          onEdit(item);
        }}
        style={styles.timelineRow}
      >
        <View style={styles.timeCol}>
          <View style={[styles.miniLine, isFirst && { opacity: 0 }]} />
          <Text style={styles.timeLabel}>{normalizeTime(item.time)}</Text>
          <View style={styles.dotContainer}>
            <View style={styles.dotOutline}>
              <View style={styles.dotInner} />
            </View>
          </View>
          <View style={[styles.miniLine, isLast && { opacity: 0 }]} />
        </View>

        <View style={styles.cardCol}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.badge, { backgroundColor: config.color, borderColor: config.borderColor }]}>
                <Icon size={12} color={config.textColor} strokeWidth={3} />
                <Text style={[styles.badgeText, { color: config.textColor }]}>
                  {item.titleEmoji || '📍'} {item.type?.toUpperCase()}
                </Text>
              </View>

              {item.mapsUrl && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(item.mapsUrl)}
                  hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                >
                  <MapPin size={18} color="#FF8FAB" />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.cardTitle}>{item.title}</Text>
            {item.note ? <Text style={styles.cardNote}>{renderTextWithLinks(item.note)}</Text> : null}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
};

// --- 主程式 ---
export default function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeDay, setActiveDay] = useState(1);
  const [itinerary, setItinerary] = useState<DayPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);

  // ✅ NEW：明確記錄 Modal 是新增還是編輯（不要用 id 判斷）
  const [itemModalMode, setItemModalMode] = useState<'create' | 'edit'>('create');

  const [showPicker, setShowPicker] = useState(false);
  const [isSummaryModalVisible, setIsSummaryModalVisible] = useState(false);
  const [tempSummary, setTempSummary] = useState('');

  const fetchFromSheets = async (isManualRefresh = false) => {
    try {
      if (!isManualRefresh) setIsLoading(true);

      // 1. 在網址後方加上時間戳記，防止網頁版抓到舊的快取資料
      const response = await fetch(`${API_URL}?t=${Date.now()}`);
      
      if (!response.ok) throw new Error(`Error: ${response.status}`);
      
      const data = await response.json();

      if (Array.isArray(data)) {
        // 2. 處理資料：確保天數是數字，並幫每一天的行程「按時間排序」
        const processedData = data.map((d) => ({
          ...d,
          day: parseInt((d as any).day, 10) || 1,
          items: sortByTime(d.items || []) // 這裡會調用我們剛才優化的 sortByTime
        }));

        // 3. 最後對「整份行程」按天數 (Day 1, Day 2...) 進行排序後存入狀態
        setItinerary(processedData.sort((a, b) => a.day - b.day));
      }
    } catch (error: any) {
      console.error("抓取雲端資料失敗:", error);
      // 出錯時可以選擇不排空，或者給一個空陣列避免崩潰
      setItinerary([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFromSheets(true);
  }, []);

  const syncToSheets = async (latestData: DayPlan[]) => {
    try {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(latestData),
        redirect: 'follow',
      });
    } catch (error) {
      console.error('Sync Error:', error);
    }
  };

  useEffect(() => {
    fetchFromSheets();
  }, []);

  const handleUpdateData = (newData: DayPlan[]) => {
    setItinerary(newData);
    syncToSheets(newData);
  };

  const currentDayData = itinerary.find((d) => d.day === activeDay);

// ✅ 核心修正：在展開 items 之前加入 sortByTime 排序
  const combinedData: ItineraryItem[] = currentDayData
    ? ([
        { id: 'sticky-tabs', itemType: 'TABS', isDummy: true } as any,
        { id: 'scroll-summary', itemType: 'SUMMARY', isDummy: true } as any,
        // 這裡加入了 sortByTime 確保顯示順序絕對正確
        ...sortByTime(currentDayData.items || []).map((i) => ({ 
          ...i, 
          itemType: 'REAL_ITEM' 
        })),
      ] as any)
    : ([{ id: 'sticky-tabs', itemType: 'TABS', isDummy: true } as any] as any);

  const handleAddDay = () => {
    const nextDayNum = itinerary.length + 1;
    handleUpdateData([...itinerary, { day: nextDayNum, summary: '', items: [] }]);
    setActiveDay(nextDayNum);
  };

  const handleDeleteDay = (dayNum: number) => {
    const performDelete = () => {
      const filtered = itinerary.filter((d) => d.day !== dayNum);
      const reordered = filtered.map((d, index) => ({ ...d, day: index + 1 }));
      handleUpdateData(reordered);

      if (activeDay === dayNum) setActiveDay(reordered.length > 0 ? 1 : 0);
      else if (activeDay > dayNum) setActiveDay(activeDay - 1);
    };

    if (Platform.OS === 'web') {
      // @ts-ignore web only
      if (window.confirm(`確定要刪除 Day ${dayNum} 的所有資料嗎？`)) performDelete();
    } else {
      Alert.alert('刪除整天', `確定要刪除 Day ${dayNum} 嗎？`, [
        { text: '取消', style: 'cancel' },
        { text: '刪除', style: 'destructive', onPress: performDelete },
      ]);
    }
  };

  const handleSaveSummary = () => {
    if (!currentDayData) return;
    handleUpdateData(itinerary.map((d) => (d.day === activeDay ? { ...d, summary: tempSummary } : d)));
    setIsSummaryModalVisible(false);
  };

  const handleDeleteItem = (id: string) => {
    handleUpdateData(itinerary.map((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) })));
  };

  const handleSave = () => {
    if (!editingItem) return;
    const updated = itinerary.map((d) => {
      if (d.day === activeDay) {
        const exists = d.items.find((i) => i.id === editingItem.id);
        const newItems = exists ? d.items.map((i) => (i.id === editingItem.id ? editingItem : i)) : [...d.items, editingItem];
        return { ...d, items: sortByTime(newItems) };
      }
      return d;
    });
    handleUpdateData(updated);
    setIsModalVisible(false);
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FF8FAB" />
        <Text style={{ marginTop: 10, color: '#FF8FAB', fontWeight: '900' }}>同步雲端中...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.rootView}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top']}>
          <StatusBar barStyle="dark-content" />

          <FlatList
            key={`list-day-${activeDay}`}
            data={combinedData}
            keyExtractor={(item) => item.id}
            stickyHeaderIndices={[1]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8FAB" />}
            ListHeaderComponent={() => (
              <View style={styles.header}>
                <View style={styles.headerTopRow}>
                  <View style={styles.topTag}>
                    <Text style={styles.topTagText}>NAGOYA 2026</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.modeToggle, isEditMode ? styles.modeToggleEdit : styles.modeToggleView]}
                    onPress={() => setIsEditMode(!isEditMode)}
                  >
                    {isEditMode ? <Edit3 size={14} color="#FFF" /> : <Lock size={14} color="#FF8FAB" />}
                    <Text style={[styles.modeToggleText, { color: isEditMode ? '#FFF' : '#FF8FAB' }]}>
                      {isEditMode ? '編輯中' : '唯讀'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.mainTitle}>🍤皮皮家族名古屋之旅🏯</Text>

                <TouchableOpacity style={styles.subtitleLink} onPress={() => Linking.openURL(MY_LIST)}>
                  <MapPin size={14} color="#FF8FAB" />
                  <Text style={styles.subtitleText}>Google 已儲存景點清單</Text>
                  <ExternalLink size={12} color="#FF8FAB" />
                </TouchableOpacity>
              </View>
            )}
            ListFooterComponent={() => (
              <View style={styles.footerContainer}>
                {isEditMode && currentDayData && (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => {
                      setItemModalMode('create');
                      setEditingItem({
                        id: genId(),
                        time: '12:00',
                        title: '',
                        note: '',
                        type: 'sight',
                        mapsUrl: '',
                      });
                      setIsModalVisible(true);
                    }}
                  >
                    <Plus color="#FFF" size={20} strokeWidth={4} />
                    <Text style={styles.addButtonText}>新增行程</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.brandingContainer}>
                  <Heart size={12} color="#FF8FAB" fill="#FF8FAB" />
                  <Text style={styles.brandingText}> PIPI FAMILY'S TRIP </Text>
                </View>
              </View>
            )}
            renderItem={({ item, index }) => {
              if (item.itemType === 'TABS') {
                return (
                  <View style={styles.tabSection}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScrollContent}>
                      {itinerary.map((plan) => (
                        <TouchableOpacity
                          key={plan.day}
                          onPress={() => setActiveDay(plan.day)}
                          onLongPress={() => isEditMode && handleDeleteDay(plan.day)}
                          delayLongPress={800}
                          style={[styles.tabItem, activeDay === plan.day && styles.tabItemActive]}
                        >
                          <Text style={[styles.tabText, activeDay === plan.day && styles.tabTextActive]}>DAY {plan.day}</Text>
                        </TouchableOpacity>
                      ))}
                      {isEditMode && (
                        <TouchableOpacity style={styles.addDayButton} onPress={handleAddDay}>
                          <Plus size={18} color="#FF8FAB" strokeWidth={3} />
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                  </View>
                );
              }

              if (item.itemType === 'SUMMARY' && currentDayData) {
                return (
                  <TouchableOpacity
                    style={styles.summaryContainer}
                    onPress={() => {
                      if (isEditMode) {
                        setTempSummary(currentDayData.summary);
                        setIsSummaryModalVisible(true);
                      }
                    }}
                    activeOpacity={isEditMode ? 0.6 : 1}
                  >
                    <Text style={styles.daySubTitle}>Day {activeDay} 摘要</Text>
                    <View style={styles.summaryDisplayBox}>
                      <Text style={[styles.summaryDisplayText, !currentDayData.summary && styles.summaryPlaceholder]}>
                        {currentDayData.summary
                          ? renderTextWithLinks(currentDayData.summary)
                          : isEditMode
                          ? '點擊新增今日重點...'
                          : '期待今天的冒險！'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }

              if (item.itemType === 'REAL_ITEM') {
                const isFirst = index === 2;
                const isLast = index === combinedData.length - 1;

                return (
                  <View>
                    <ItineraryItemRow
                      item={item}
                      isFirst={isFirst}
                      isLast={isLast}
                      isEditMode={isEditMode}
                      onEdit={(it: any) => {
                        setItemModalMode('edit');
                        setEditingItem(it);
                        setIsModalVisible(true);
                      }}
                      onDelete={handleDeleteItem}
                    />
                    {(() => {
                    if (isLast) return null;

                    const next = combinedData[index + 1] as ItineraryItem;

                    // ✅ A 或 B 沒貼 Google Maps 連結 → 不顯示「路線規劃」
                    if (!hasMapsUrl(item) || !hasMapsUrl(next)) return null;

                    return <RouteConnector fromItem={item} toItem={next} />;
                    })()}
                  </View>
                );
              }

              return null;
            }}
            contentContainerStyle={styles.scrollPadding}
          />

          {/* 摘要 Modal */}
          <Modal animationType="fade" transparent visible={isSummaryModalVisible}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { height: 'auto' }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>編輯摘要</Text>
                  <TouchableOpacity onPress={() => setIsSummaryModalVisible(false)}>
                    <X size={24} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.input, { height: 150, textAlignVertical: 'top' }]}
                  multiline
                  autoFocus
                  value={tempSummary}
                  onChangeText={setTempSummary}
                />

                <TouchableOpacity style={styles.saveButton} onPress={handleSaveSummary}>
                  <Check size={20} color="#FFF" />
                  <Text style={styles.saveButtonText}>儲存摘要</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* 行程 Modal */}
          <Modal animationType="slide" transparent visible={isModalVisible}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{itemModalMode === 'create' ? '新增行程' : '編輯行程'}</Text>
                  <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                    <X size={24} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {editingItem && (
                    <View style={styles.form}>
                      <Text style={styles.inputLabel}>行程類別</Text>
                      <View style={styles.typeSelector}>
                        {[
                          { label: '交通', value: 'transport', icon: Plane },
                          { label: '住宿', value: 'hotel', icon: MapPin },
                          { label: '美食', value: 'food', icon: Utensils },
                          { label: '景點', value: 'sight', icon: Camera },
                          { label: '購物', value: 'shopping', icon: Store },
                          { label: '其他', value: 'other', icon: Info },
                        ].map((type) => (
                          <TouchableOpacity
                            key={type.value}
                            onPress={() => setEditingItem({ ...editingItem, type: type.value })}
                            style={[
                              styles.typeChip,
                              editingItem.type === type.value && {
                                backgroundColor: getTypeConfig(type.value).color,
                                borderColor: getTypeConfig(type.value).borderColor,
                              },
                            ]}
                          >
                            <type.icon
                              size={16}
                              color={editingItem.type === type.value ? getTypeConfig(type.value).textColor : '#9CA3AF'}
                            />
                            <Text
                              style={[
                                styles.typeChipText,
                                editingItem.type === type.value && { color: getTypeConfig(type.value).textColor },
                              ]}
                            >
                              {type.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={styles.inputLabel}>時間</Text>
                      {Platform.OS === 'web' ? (
                        // @ts-ignore web only
                        <input
                          type="time"
                          value={editingItem.time}
                          onChange={(e) => setEditingItem({ ...editingItem, time: e.target.value })}
                          style={{
                            padding: '16px',
                            fontSize: '16px',
                            borderRadius: '18px',
                            border: '1.5px solid #E5E7EB',
                            backgroundColor: '#F9FAFB',
                            fontFamily: 'inherit',
                          }}
                        />
                      ) : Platform.OS === 'ios' ? (
                        <View style={styles.iosPickerRow}>
                          <View style={styles.iosPickerLeft}>
                            <Clock size={18} color="#FF8FAB" />
                            <Text style={styles.iosPickerLabel}>選擇時間</Text>
                          </View>
                          <DateTimePicker
                            value={parseTimeToDate(editingItem.time)}
                            mode="time"
                            display="compact"
                            onChange={(_: any, d?: Date) => d && setEditingItem({ ...editingItem, time: formatDateToString(d) })}
                            locale="zh-Hant"
                            style={styles.iosPickerComponent}
                          />
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.timePickerTrigger} onPress={() => setShowPicker(true)}>
                          <Clock size={18} color="#FF8FAB" />
                          <Text style={styles.timePickerTriggerText}>{editingItem.time}</Text>
                        </TouchableOpacity>
                      )}

                      <Text style={styles.inputLabel}>地點名稱</Text>
                      <TextInput style={styles.input} value={editingItem.title} onChangeText={(t) => setEditingItem({ ...editingItem, title: t })} />

                      <Text style={styles.inputLabel}>Maps 連結</Text>
                      <TextInput style={styles.input} value={editingItem.mapsUrl} onChangeText={(t) => setEditingItem({ ...editingItem, mapsUrl: t })} />

                      <Text style={styles.inputLabel}>備註</Text>
                      <TextInput
                        style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
                        value={editingItem.note}
                        multiline
                        onChangeText={(t) => setEditingItem({ ...editingItem, note: t })}
                      />

                      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                        <Check size={20} color="#FFF" />
                        <Text style={styles.saveButtonText}>儲存行程</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  rootView: {
    flex: 1,
    height: Platform.OS === 'web' ? ('100vh' as any) : '100%',
    overflow: Platform.OS === 'web' ? ('auto' as any) : 'hidden',
  },
  container: { flex: 1, backgroundColor: '#FFFDF8' },
  scrollPadding: { paddingBottom: 150 },

  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topTag: { backgroundColor: '#FF8FAB', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  topTagText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, gap: 6, borderWidth: 1.5 },
  modeToggleEdit: { backgroundColor: '#FF8FAB', borderColor: '#FF8FAB' },
  modeToggleView: { backgroundColor: '#FFF', borderColor: '#FFE4EB' },
  modeToggleText: { fontSize: 11, fontWeight: '900' },
  mainTitle: { fontSize: 36, fontWeight: '900', color: '#111827', lineHeight: 44, letterSpacing: -1.5 },
  subtitleLink: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  subtitleText: { fontSize: 14, color: '#FF8FAB', fontWeight: '800', textDecorationLine: 'underline' },

  tabSection: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFFDF8' },
  tabScrollContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tabItem: { minWidth: 90, alignItems: 'center', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#FFF', elevation: 3 },
  tabItemActive: { backgroundColor: '#FF8FAB' },
  tabText: { fontSize: 14, fontWeight: '900', color: '#D1D5DB' },
  tabTextActive: { color: '#FFF' },
  addDayButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFE4EB' },

  summaryContainer: { paddingHorizontal: 24, paddingVertical: 20, backgroundColor: '#FFFDF8' },
  daySubTitle: { fontSize: 26, fontWeight: '900', color: '#111827', fontStyle: 'italic', marginBottom: 8 },
  summaryDisplayBox: { paddingTop: 6 },
  summaryDisplayText: { fontSize: 18, color: '#4B5563', lineHeight: 28, fontWeight: '500' },
  summaryPlaceholder: { color: '#D1D5DB', fontStyle: 'italic' },
  linkText: { color: '#2563EB', textDecorationLine: 'underline' },

  timelineRow: { flexDirection: 'row', paddingHorizontal: 24, backgroundColor: '#FFFDF8' },
  timeCol: { width: 70, alignItems: 'center' },
  timeLabel: { fontSize: 16, fontWeight: '900', color: '#FF8FAB', marginTop: 10, marginBottom: 4, fontVariant: ['tabular-nums'] },
  miniLine: { width: 2, flex: 1, backgroundColor: '#FF8FAB', opacity: 0.3 },
  dotContainer: { height: 26, justifyContent: 'center' },
  dotOutline: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF', borderWidth: 6, borderColor: '#FF8FAB', alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FF8FAB' },

  cardCol: { flex: 1, paddingLeft: 12, paddingVertical: 12 },
  card: { backgroundColor: '#FFF', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: '#F3F4F6', elevation: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  cardTitle: { fontSize: 18, fontWeight: '900', color: '#1F2937' },
  cardNote: { fontSize: 14, color: '#6B7280', marginTop: 6, lineHeight: 20 },

  deleteAction: { backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', width: 85, borderRadius: 28, marginVertical: 12, marginRight: 24 },
  deleteActionText: { color: '#FFF', fontSize: 12, fontWeight: '900', marginTop: 6 },

  routeWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, height: 70 },
  routeLineContainer: { width: 70, alignItems: 'center', height: '100%' },
  fullVerticalLine: { width: 2, height: '100%', backgroundColor: '#FF8FAB', opacity: 0.3 },
  routePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5, borderColor: '#FFE4EB', gap: 8, marginLeft: 12, elevation: 2 },
  routePillText: { fontSize: 12, fontWeight: '900', color: '#FF8FAB' },

  footerContainer: { padding: 30, alignItems: 'center', gap: 40 },
  addButton: { backgroundColor: '#FF8FAB', borderRadius: 24, paddingVertical: 18, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 12, width: '90%', justifyContent: 'center', elevation: 8 },
  addButtonText: { color: '#FFF', fontSize: 18, fontWeight: '900' },

  brandingContainer: { flexDirection: 'row', alignItems: 'center', opacity: 0.4, marginBottom: 20 },
  brandingText: { fontSize: 13, fontWeight: '900', color: '#FF8FAB', letterSpacing: 4, fontStyle: 'italic' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#111827' },
  form: { gap: 18 },

  input: { backgroundColor: '#F9FAFB', borderRadius: 18, padding: 18, fontSize: 16, borderWidth: 1.5, borderColor: '#E5E7EB' },
  inputLabel: { fontSize: 14, fontWeight: '800', color: '#374151', marginBottom: -8 },
  typeSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E7EB' },
  typeChipText: { fontSize: 13, fontWeight: '800', color: '#9CA3AF' },

  iosPickerRow: { backgroundColor: '#F9FAFB', borderRadius: 18, paddingHorizontal: 18, height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: '#E5E7EB' },
  iosPickerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iosPickerLabel: { fontSize: 16, color: '#6B7280', fontWeight: '700' },
  iosPickerComponent: { height: 44, marginRight: -10 },

  timePickerTrigger: { backgroundColor: '#F9FAFB', borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: '#E5E7EB', height: 60 },
  timePickerTriggerText: { fontSize: 17, color: '#111827', fontWeight: '700' },

  saveButton: { backgroundColor: '#FF8FAB', borderRadius: 20, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
  saveButtonText: { color: '#FFF', fontSize: 18, fontWeight: '900' },
});
