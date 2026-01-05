import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Camera, Check, Clock, Edit3, ExternalLink, Heart,
  Info, Lock, MapPin, Navigation, Plane, Plus,
  Store, Trash2, Utensils, X
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react'; // 新增 useCallback
import {
  ActivityIndicator,
  Dimensions, KeyboardAvoidingView, Linking, Modal,
  Platform,
  RefreshControl, // 1. 新增：匯入下拉更新元件
  ScrollView, StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// 從環境變數讀取，如果讀不到則給空字串避免噴錯
const API_URL = process.env.EXPO_PUBLIC_API_URL || "";
const MY_LIST = process.env.EXPO_PUBLIC_MAPS_LIST_URL || "";

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

// --- 工具函式 ---
const renderTextWithLinks = (text: string) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return <Text key={index} style={styles.linkText} onPress={() => Linking.openURL(part)}>{part}</Text>;
    }
    return <Text key={index}>{part}</Text>;
  });
};

const parseTimeToDate = (timeStr: string) => {
  const [hours, minutes] = (timeStr || "12:00").split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes);
  return date;
};

const formatDateToString = (date: Date) => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

const sortByTime = (items: ItineraryItem[]) => {
  return [...items].sort((a, b) => a.time.localeCompare(b.time));
};

const getTypeConfig = (type: string) => {
  switch (type) {
    case 'food': return { color: '#FFF7ED', textColor: '#EA580C', borderColor: '#FFEDD5', icon: Utensils };
    case 'sight': return { color: '#ECFDF5', textColor: '#059669', borderColor: '#D1FAE5', icon: Camera };
    case 'transport': return { color: '#EFF6FF', textColor: '#2563EB', borderColor: '#DBEAFE', icon: Plane };
    case 'hotel': return { color: '#F5F3FF', textColor: '#7C3AED', borderColor: '#EDE9FE', icon: MapPin };
    case 'shopping': return { color: '#FFF1F2', textColor: '#E11D48', borderColor: '#FFE4E6', icon: Store };
    default: return { color: '#F9FAFB', textColor: '#4B5563', borderColor: '#F3F4F6', icon: Info };
  }
};

// --- 子組件：路線連接器 ---
const RouteConnector = ({ fromItem, toItem }: { fromItem: ItineraryItem, toItem: ItineraryItem }) => {
  const handleOpenRoute = () => {
    const url = `https://maps.app.goo.gl/zzz5{encodeURIComponent(fromItem.title)}&destination=${encodeURIComponent(toItem.title)}&travelmode=transit`;
    Linking.openURL(url);
  };
  return (
    <View style={styles.routeWrapper}>
      <View style={styles.routeLineContainer}><View style={styles.fullVerticalLine} /></View>
      <TouchableOpacity style={styles.routePill} onPress={handleOpenRoute}>
        <Navigation size={12} color="#FF8FAB" strokeWidth={3} /><Text style={styles.routePillText}>路線規劃</Text><ExternalLink size={10} color="#FF8FAB" />
      </TouchableOpacity>
    </View>
  );
};

// --- 子組件：行程卡片 ---
const ItineraryItemRow = ({ item, onEdit, onDelete, drag, isActive, isFirst, isLast, isEditMode }: any) => {
  const config = getTypeConfig(item.type);
  const Icon = config.icon;

  const renderRightActions = () => {
    if (!isEditMode) return null;
    return (
      <TouchableOpacity style={styles.deleteAction} onPress={() => onDelete(item.id)}>
        <Trash2 color="#FFF" size={24} /><Text style={styles.deleteActionText}>刪除</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable renderRightActions={renderRightActions} enabled={isEditMode}>
      <ScaleDecorator>
        <TouchableOpacity 
          activeOpacity={isEditMode ? 0.9 : 1} 
          onLongPress={isEditMode ? drag : undefined}
          onPress={() => isEditMode && onEdit(item)}
          style={[styles.timelineRow, isActive && styles.draggingRow]}
        >
          <View style={styles.timeCol}>
            <View style={[styles.miniLine, isFirst && { opacity: 0 }]} /> 
            <Text style={styles.timeLabel}>{item.time}</Text>
            <View style={styles.dotContainer}><View style={styles.dotOutline}><View style={styles.dotInner} /></View></View>
            <View style={[styles.miniLine, isLast && { opacity: 0 }]} />
          </View>
          <View style={styles.cardCol}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, { backgroundColor: config.color, borderColor: config.borderColor }]}>
                  <Icon size={12} color={config.textColor} strokeWidth={3} />
                  <Text style={[styles.badgeText, { color: config.textColor }]}>{item.titleEmoji || '📍'} {item.type?.toUpperCase()}</Text>
                </View>
                {item.mapsUrl && (
                  <TouchableOpacity onPress={() => Linking.openURL(item.mapsUrl)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                    <MapPin size={18} color="#FF8FAB" />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.note ? <Text style={styles.cardNote}>{renderTextWithLinks(item.note)}</Text> : null}
            </View>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    </Swipeable>
  );
};

// --- 主程式 ---
export default function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeDay, setActiveDay] = useState(1);
  const [itinerary, setItinerary] = useState<DayPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // 2. 新增：下拉更新狀態
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ItineraryItem | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [isSummaryModalVisible, setIsSummaryModalVisible] = useState(false);
  const [tempSummary, setTempSummary] = useState("");

  // 3. 修改：資料抓取函式，新增參數區分下拉或初次載入
  const fetchFromSheets = async (isManualRefresh = false) => {
    try {
      if (!isManualRefresh) setIsLoading(true);
      
      // 增加超時控制，避免無限等待
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(API_URL, { 
        method: 'GET',
        signal: controller.signal 
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`伺服器回應錯誤: ${response.status}`);
      }

      const data = await response.json();
      
      if (Array.isArray(data)) {
        const processedData = data.map(d => ({
          ...d,
          day: parseInt(d.day, 10) || 1 // 確保 day 是數字
        }));
        setItinerary(processedData);
      } else {
        console.warn("回傳格式非陣列:", data);
        setItinerary([]);
      }
    } catch (error: any) {
      // 這裡會抓到具體的錯誤原因
      let errorMsg = "連線失敗";
      if (error.name === 'AbortError') errorMsg = "連線超時 (請檢查網路或 API 網址)";
      else if (error.message.includes("JSON")) errorMsg = "資料格式錯誤 (GAS 可能回傳了錯誤網頁)";
      
      console.error("具體錯誤訊息:", error.message);
      alert(`${errorMsg}\n請檢查 GAS 部署權限是否設為『任何人』`);
      setItinerary([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  // 4. 新增：下拉觸發的事件函式
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFromSheets(true);
  }, []);

  // 2. 同步回雲端
  const syncToSheets = async (latestData: DayPlan[]) => {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8', // GAS 有時對 application/json 較嚴格，用 text/plain 通常更穩
        },
        body: JSON.stringify(latestData),
        redirect: 'follow' // 強制跟隨重導向
      });
      const result = await response.text();
      console.log("同步結果:", result);
    } catch (error) {
      console.error("Sync Error:", error);
    }
  };

  useEffect(() => { fetchFromSheets(); }, []);

  const handleUpdateData = (newData: DayPlan[]) => {
    setItinerary(newData);
    syncToSheets(newData);
  };

  const currentDayData = itinerary.find(d => d.day === activeDay);

  const combinedData: ItineraryItem[] = currentDayData ? [
    { id: 'sticky-tabs', itemType: 'TABS', isDummy: true } as any,
    { id: 'scroll-summary', itemType: 'SUMMARY', isDummy: true } as any,
    ...currentDayData.items.map(i => ({ ...i, itemType: 'REAL_ITEM' })) as any
  ] : [
    { id: 'sticky-tabs', itemType: 'TABS', isDummy: true } as any
  ];

  // 功能邏輯
  const handleAddDay = () => {
    const nextDayNum = itinerary.length + 1;
    handleUpdateData([...itinerary, { day: nextDayNum, summary: "", items: [] }]);
    setActiveDay(nextDayNum);
  };

  const handleSaveSummary = () => {
    if (!currentDayData) return;
    handleUpdateData(itinerary.map(d => d.day === activeDay ? { ...d, summary: tempSummary } : d));
    setIsSummaryModalVisible(false);
  };

  const handleDragEnd = ({ data }: { data: ItineraryItem[] }) => {
    if (!isEditMode || !currentDayData) return;
    const onlyItems = data.filter(item => !item.isDummy);
    handleUpdateData(itinerary.map(d => d.day === activeDay ? { ...d, items: onlyItems } : d));
  };

  const handleDeleteItem = (id: string) => {
    handleUpdateData(itinerary.map(d => ({ ...d, items: d.items.filter(i => i.id !== id) })));
  };

  const handleSave = () => {
    if (!editingItem) return;
    const updated = itinerary.map(d => {
      if (d.day === activeDay) {
        const exists = d.items.find(i => i.id === editingItem.id);
        const newItems = exists ? d.items.map(i => i.id === editingItem.id ? editingItem : i) : [...d.items, editingItem];
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
        <Heart size={40} color="#FF8FAB" fill="#FF8FAB" style={{ marginTop: 20, opacity: 0.5 }} />
        <Text style={{ marginTop: 10, color: '#FF8FAB', fontWeight: '900' }}>同步雲端中...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top']}>
          <StatusBar barStyle="dark-content" />
          
          <DraggableFlatList
            data={combinedData}
            onDragEnd={handleDragEnd}
            keyExtractor={(item) => item.id}
            stickyHeaderIndices={[1]}
            // 5. 新增：設定下拉更新元件
            refreshControl={
              <RefreshControl 
                refreshing={refreshing} 
                onRefresh={onRefresh} 
                tintColor="#FF8FAB" // iOS 圈圈顏色
                colors={["#FF8FAB"]} // Android 圈圈顏色
              />
            }
            ListHeaderComponent={() => (
              <View style={styles.header}>
                <View style={styles.headerTopRow}>
                  <View style={styles.topTag}><Text style={styles.topTagText}>NAGOYA 2026</Text></View>
                  <TouchableOpacity style={[styles.modeToggle, isEditMode ? styles.modeToggleEdit : styles.modeToggleView]} onPress={() => setIsEditMode(!isEditMode)}>
                    {isEditMode ? <Edit3 size={14} color="#FFF" /> : <Lock size={14} color="#FF8FAB" />}
                    <Text style={[styles.modeToggleText, { color: isEditMode ? '#FFF' : '#FF8FAB' }]}>{isEditMode ? "編輯中" : "唯讀"}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.mainTitle}>🍤皮皮家族名古屋之旅🏯</Text>
                <TouchableOpacity style={styles.subtitleLink} onPress={() => Linking.openURL(MY_LIST)}>
                  <MapPin size={14} color="#FF8FAB" /><Text style={styles.subtitleText}>Google 已儲存景點清單</Text><ExternalLink size={12} color="#FF8FAB" />
                </TouchableOpacity>
              </View>
            )}
            ListFooterComponent={() => (
              <View style={styles.footerContainer}>
                {isEditMode && currentDayData && (
                  <TouchableOpacity style={styles.addButton} onPress={() => { setEditingItem({ id: `new-${Date.now()}`, time: "12:00", title: "", note: "", type: "sight", mapsUrl: "" }); setIsModalVisible(true); }}>
                    <Plus color="#FFF" size={20} strokeWidth={4} /><Text style={styles.addButtonText}>新增行程</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.brandingContainer}>
                  <Heart size={12} color="#FF8FAB" fill="#FF8FAB" />
                  <Text style={styles.brandingText}> PIPI FAMILY'S TRIP </Text>
                  <Heart size={12} color="#FF8FAB" fill="#FF8FAB" />
                </View>
              </View>
            )}
            renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<ItineraryItem>) => {
              const currentIndex = getIndex();
              if (item.itemType === 'TABS') {
                return (
                  <View style={styles.tabSection}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScrollContent}>
                      {itinerary.map((plan) => (
                        <TouchableOpacity key={plan.day} onPress={() => setActiveDay(plan.day)} style={[styles.tabItem, activeDay === plan.day && styles.tabItemActive]}>
                          <Text style={[styles.tabText, activeDay === plan.day && styles.tabTextActive]}>DAY {plan.day}</Text>
                        </TouchableOpacity>
                      ))}
                      {isEditMode && <TouchableOpacity style={styles.addDayButton} onPress={handleAddDay}><Plus size={18} color="#FF8FAB" strokeWidth={3} /></TouchableOpacity>}
                    </ScrollView>
                  </View>
                );
              }
              if (item.itemType === 'SUMMARY' && currentDayData) {
                return (
                  <TouchableOpacity style={styles.summaryContainer} onPress={() => { if(isEditMode) { setTempSummary(currentDayData.summary); setIsSummaryModalVisible(true); } }} activeOpacity={isEditMode ? 0.6 : 1}>
                    <Text style={styles.daySubTitle}>Day {activeDay} 摘要</Text>
                    <View style={styles.summaryDisplayBox}>
                      <Text style={[styles.summaryDisplayText, !currentDayData.summary && styles.summaryPlaceholder]}>
                        {currentDayData.summary ? renderTextWithLinks(currentDayData.summary) : isEditMode ? "點擊新增今日重點..." : "期待今天的冒險！"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }
              if (item.itemType === 'REAL_ITEM') {
                const isFirst = currentIndex === 2;
                const isLast = currentIndex === combinedData.length - 1;
                return (
                  <View>
                    <ItineraryItemRow item={item} drag={drag} isActive={isActive} isFirst={isFirst} isLast={isLast} isEditMode={isEditMode} onEdit={(it: any) => { setEditingItem(it); setIsModalVisible(true); }} onDelete={handleDeleteItem} />
                    {currentIndex !== undefined && !isLast && !isActive && <RouteConnector fromItem={item} toItem={combinedData[currentIndex + 1]} />}
                  </View>
                );
              }
              return null;
            }}
            contentContainerStyle={styles.scrollPadding}
          />

          {/* Modal 部分保持不變 */}
          <Modal animationType="fade" transparent visible={isSummaryModalVisible}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
              <View style={[styles.modalContent, { height: 'auto' }]}>
                <View style={styles.modalHeader}><Text style={styles.modalTitle}>編輯摘要</Text><TouchableOpacity onPress={() => setIsSummaryModalVisible(false)}><X size={24} color="#9CA3AF" /></TouchableOpacity></View>
                <TextInput style={[styles.input, { height: 150, textAlignVertical: 'top' }]} multiline autoFocus value={tempSummary} onChangeText={setTempSummary} />
                <TouchableOpacity style={styles.saveButton} onPress={handleSaveSummary}><Check size={20} color="#FFF" /><Text style={styles.saveButtonText}>儲存摘要</Text></TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <Modal animationType="slide" transparent visible={isModalVisible}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingItem?.id.startsWith('new') ? '新增行程' : '修改行程'}</Text><TouchableOpacity onPress={() => setIsModalVisible(false)}><X size={24} color="#9CA3AF" /></TouchableOpacity></View>
                {editingItem && (
                  <View style={styles.form}>
                    <Text style={styles.inputLabel}>行程類別</Text>
                    <View style={styles.typeSelector}>{[
                      { label: '交通', value: 'transport', icon: Plane }, { label: '住宿', value: 'hotel', icon: MapPin },
                      { label: '美食', value: 'food', icon: Utensils }, { label: '景點', value: 'sight', icon: Camera },
                      { label: '購物', value: 'shopping', icon: Store }, { label: '其他', value: 'other', icon: Info },
                    ].map((type) => (
                      <TouchableOpacity key={type.value} onPress={() => setEditingItem({ ...editingItem, type: type.value })} style={[styles.typeChip, editingItem.type === type.value && { backgroundColor: getTypeConfig(type.value).color, borderColor: getTypeConfig(type.value).borderColor }]}>
                        <type.icon size={16} color={editingItem.type === type.value ? getTypeConfig(type.value).textColor : '#9CA3AF'} /><Text style={[styles.typeChipText, editingItem.type === type.value && { color: getTypeConfig(type.value).textColor }]}>{type.label}</Text>
                      </TouchableOpacity>
                    ))}</View>
                    <Text style={styles.inputLabel}>時間</Text>
                    {Platform.OS === 'ios' ? (
                      <View style={styles.iosPickerRow}><View style={styles.iosPickerLeft}><Clock size={18} color="#FF8FAB" /><Text style={styles.iosPickerLabel}>選擇時間</Text></View><DateTimePicker value={parseTimeToDate(editingItem.time)} mode="time" display="compact" onChange={(_: any, d?: Date) => d && setEditingItem({...editingItem, time: formatDateToString(d)})} locale="zh-Hant" style={styles.iosPickerComponent} /></View>
                    ) : (
                      <TouchableOpacity style={styles.timePickerTrigger} onPress={() => setShowPicker(true)}><Clock size={18} color="#FF8FAB" /><Text style={styles.timePickerTriggerText}>{editingItem.time}</Text></TouchableOpacity>
                    )}
                    <Text style={styles.inputLabel}>地點名稱</Text><TextInput style={styles.input} value={editingItem.title} onChangeText={(t) => setEditingItem({...editingItem, title: t})} />
                    <Text style={styles.inputLabel}>Google Maps 連結</Text><TextInput style={styles.input} value={editingItem.mapsUrl} onChangeText={(t) => setEditingItem({...editingItem, mapsUrl: t})} />
                    <Text style={styles.inputLabel}>備註</Text><TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} value={editingItem.note} multiline onChangeText={(t) => setEditingItem({...editingItem, note: t})} />
                    <TouchableOpacity style={styles.saveButton} onPress={handleSave}><Check size={20} color="#FFF" /><Text style={styles.saveButtonText}>儲存</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            </KeyboardAvoidingView>
          </Modal>

        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
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
  draggingRow: { backgroundColor: '#FFF', elevation: 12, borderRadius: 20 },
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
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 40 },
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
  saveButton: { backgroundColor: '#FF8FAB', borderRadius: 20, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  saveButtonText: { color: '#FFF', fontSize: 18, fontWeight: '900' }
});