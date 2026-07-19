// Vista "Grafici" della tab Scadenzario: proiezione mensile, torta per
// categoria, aging e statistiche. Estratta da ScadenzarioSmart.tsx
// (spezzatura ondata 9) senza cambi funzionali: dati aggregati via props.
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../../components/ChartTheme';
import { fmt } from './helpers';
import type { PayableLite } from './SituazioneTab';

export function ScadenzeCharts({ monthlyData, categoryData, agingAnalysis, displayPayables }: {
  monthlyData: Array<{ month: string; scadenze: number }>
  categoryData: Array<{ name: string; value: number }>
  agingAnalysis: Array<{ range: string; value: number }>
  displayPayables: PayableLite[]
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900 mb-1 text-sm">Proiezione Scadenze</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyData}>
            <CartesianGrid {...GRID_STYLE} strokeDasharray="3 3" />
            <XAxis dataKey="month" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <RechartsTooltip content={<GlassTooltip />} />
            <Bar dataKey="scadenze" fill="#6366f1" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900 mb-1 text-sm">Categoria</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={categoryData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name">
              {categoryData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'][index % 5]} />
              ))}
            </Pie>
            <RechartsTooltip />
            {/* Senza legenda le fette erano leggibili solo passando sul
                tooltip: su touch la torta era muta */}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900 mb-1 text-sm">Aging</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={agingAnalysis}>
            <CartesianGrid {...GRID_STYLE} strokeDasharray="3 3" />
            <XAxis dataKey="range" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <RechartsTooltip content={<GlassTooltip />} />
            <Bar dataKey="value" fill="#ef4444" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium text-slate-900 mb-1 text-sm">Statistiche</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between pb-2 border-b border-slate-200">
            <span className="text-slate-600">Fatture</span>
            <span className="font-bold">{displayPayables.length}</span>
          </div>
          <div className="flex justify-between pb-2 border-b border-slate-200">
            <span className="text-slate-600">Fornitori</span>
            <span className="font-bold">{new Set(displayPayables.map(p => p.suppliers?.ragione_sociale)).size}</span>
          </div>
          <div className="flex justify-between pb-2 border-b border-slate-200">
            <span className="text-slate-600">Importo Medio</span>
            <span className="font-bold">{fmt(displayPayables.length > 0 ? displayPayables.reduce((s, p) => s + (p.amount_remaining || 0), 0) / displayPayables.length : 0)} €</span>
          </div>
        </div>
      </div>
    </div>
  );
}
