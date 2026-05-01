<script setup>
import { ref } from 'vue'

// 示例交互组件：数据展示卡片
const stats = ref([
  { label: 'ERP系统', value: '用友U8', color: '#1890ff' },
  { label: 'MES系统', value: '北京虎蜥', color: '#52c41a' },
  { label: 'OA系统', value: '华天动力', color: '#fa8c16' },
])

const activeIndex = ref(0)
const nextSlide = () => {
  activeIndex.value = (activeIndex.value + 1) % 3
}
</script>

<template>
  <!-- 使用方式：在 Markdown 中使用 <Components /> 标签嵌入 -->
  <div class="stats-grid">
    <div v-for="(stat, i) in stats" :key="i" class="stat-card" :style="{ borderColor: stat.color }">
      <div class="stat-label">{{ stat.label }}</div>
      <div class="stat-value" :style="{ color: stat.color }">{{ stat.value }}</div>
    </div>
  </div>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  padding: 2rem 0;
}
.stat-card {
  padding: 1.5rem;
  border: 2px solid;
  border-radius: 12px;
  text-align: center;
  background: rgba(255,255,255,0.9);
}
.stat-label {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.5rem;
}
.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
}
</style>
