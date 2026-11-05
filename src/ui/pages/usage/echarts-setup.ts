import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent, VisualMapPiecewiseComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, MarkLineComponent, TooltipComponent, VisualMapPiecewiseComponent, CanvasRenderer]);

export { echarts };
