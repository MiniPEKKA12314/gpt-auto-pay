<script setup lang="ts">
import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = withDefaults(defineProps<{ option: EChartsCoreOption; height?: string }>(), { height: "280px" });
const element = ref<HTMLDivElement>();
let chart: echarts.ECharts | undefined;
let observer: ResizeObserver | undefined;

function render() {
  if (!element.value) return;
  if (!chart) chart = echarts.init(element.value);
  chart.setOption(props.option, true);
}

onMounted(() => {
  render();
  observer = new ResizeObserver(() => chart?.resize());
  if (element.value) observer.observe(element.value);
});
watch(() => props.option, render, { deep: true });
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<template><div ref="element" :style="{ width: '100%', height }" /></template>
