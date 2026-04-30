// @ts-nocheck
// TODO: tighten types
import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import {
  ChevronDown,
  AlertCircle,
  Clock,
  Users,
  Package,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Cloud,
  CloudRain,
  Sun,
  AlertOctagon,
  Send,
  ShoppingCart,
  FileText,
} from 'lucide-react';

const StoreManager = () => {
  const outlets = [
    { id: 'vdc', label: 'Valdichiana (VDC)', city: 'Arezzo' },
    { id: 'brb', label: 'Barberino (BRB)', city: 'Firenze' },
    { id: 'plm', label: 'Palmanova (PLM)', city: 'Udine' },
    { id: 'frc', label: 'Franciacorta (FRC)', city: 'Brescia' },
    { id: 'brg', label: 'Brugnato (BRG)', city: 'La Spezia' },
    { id: 'vlm', label: 'Valmontone (VLM)', city: 'Roma' },
    { id: 'trn', label: 'Torino (TRN)', city: 'Torino' },
  ];

  const [selectedOutlet, setSelectedOutlet] = useState('vdc');
  const [checklist, setChecklist] = useState<{ id: number; label: string; completed: boolean }[]>([
    { id: 1, label: 'Riordino magazzino', completed: false },
    { id: 2, label: 'Verifica esposizione', completed: true },
    { id: 3, label: 'Chiusura cassa', completed: false },
    { id: 4, label: 'Inventario parziale', completed: false },
    { id: 5, label: 'Restock vetrina', completed: true },
  ]);

  // Today's snapshot data
  const todayData = {
    incasso: 3850.50,
    scontrini: 15,
    scontrino_medio: 256.70,
    obiettivo_giornaliero: 5200,
    pezzi_venduti: 34,
    ricavo_vs_anno_precedente: 12.5, // %
  };

  const percentRaggiungimento = (todayData.incasso / todayData.obiettivo_giornaliero) * 100;

  // Weekly data
  const weeklyData = {
    ricavo_settimana: 18500,
    obiettivo_settimanale: 26000,
  };

  const percentSettimanale = (weeklyData.ricavo_settimana / weeklyData.obiettivo_settimanale) * 100;

  // Monthly data
  const monthlyData = {
    ricavo_mese: 52300,
    budget_mensile: 94000,
  };

  const percentMensile = (monthlyData.ricavo_mese / monthlyData.budget_mensile) * 100;

  // Hourly sales data
  const orariData = [
    { ora: '10:00', vendite: 180 },
    { ora: '11:00', vendite: 320 },
    { ora: '12:00', vendite: 520 },
    { ora: '13:00', vendite: 280 },
    { ora: '14:00', vendite: 450 },
    { ora: '15:00', vendite: 620 },
    { ora: '16:00', vendite: 0 },
    { ora: '17:00', vendite: 0 },
    { ora: '18:00', vendite: 0 },
    { ora: '19:00', vendite: 0 },
    { ora: '20:00', vendite: 0 },
  ];

  // Staff on duty
  const staffData = [
    { id: 1, nome: 'Felici Silvia', turno: 'mattina', ore: 6, vendite: 920 },
    { id: 2, nome: 'Lorenzini Martina', turno: 'mattina', ore: 6, vendite: 850 },
    { id: 3, nome: 'Mucciarelli Ginevra', turno: 'pomeriggio', ore: 4, vendite: 680 },
    { id: 4, nome: 'Tavanti Sara', turno: 'giornata', ore: 8, vendite: 1400 },
  ];

  // Top 5 products
  const topProducts = [
    { id: 1, nome: 'Jeans Slim 32', quantita: 8, importo: 640 },
    { id: 2, nome: 'Maglietta Basic Bianca', quantita: 12, importo: 420 },
    { id: 3, nome: 'Giacca Invernale', quantita: 3, importo: 1050 },
    { id: 4, nome: 'Pantaloni Chino', quantita: 6, importo: 480 },
    { id: 5, nome: 'Cardigan Lana', quantita: 5, importo: 260 },
  ];

  // Comparison data
  const comparativeData = {
    oggi: 3850.50,
    ieri: 3420.80,
    media_7gg: 3640.30,
  };

  // Weather placeholder
  const weatherData = {
    temp: 18,
    condition: 'Nuvoloso',
    icon: 'cloud',
  };

  const toggleChecklist = (id: number) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const currentOutlet = outlets.find((o) => o.id === selectedOutlet);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard Punto Vendita</h1>
            <p className="text-sm text-gray-500 mt-1">New Zago S.R.L. • Giovedì 3 Aprile 2026</p>
          </div>

          {/* Outlet Selector */}
          <div className="relative">
            <button
              onClick={() => setSelectedOutlet((current) => current)}
              className="flex items-center gap-3 bg-white border border-gray-300 rounded-lg px-4 py-3 hover:bg-gray-50 transition"
            >
              <span className="text-gray-900 font-medium">{currentOutlet.label}</span>
              <ChevronDown size={18} className="text-gray-500" />
            </button>

            {/* Dropdown menu */}
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
              {outlets.map((outlet) => (
                <button
                  key={outlet.id}
                  onClick={() => setSelectedOutlet(outlet.id)}
                  className={`block w-full text-left px-4 py-2 text-sm transition ${
                    selectedOutlet === outlet.id
                      ? 'bg-blue-50 text-blue-900 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {outlet.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: KPIs and Charts */}
        <div className="col-span-8 space-y-6">
          {/* Today's KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {/* Incasso */}
            <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Incasso Oggi</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    €{todayData.incasso.toFixed(2)}
                  </p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <ShoppingCart size={20} className="text-blue-600" />
                </div>
              </div>
            </div>

            {/* Scontrini */}
            <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Scontrini</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{todayData.scontrini}</p>
                  <p className="text-xs text-gray-500 mt-1">ore 14:00</p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <FileText size={20} className="text-green-600" />
                </div>
              </div>
            </div>

            {/* Scontrino Medio */}
            <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Scontrino Medio</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    €{todayData.scontrino_medio.toFixed(2)}
                  </p>
                </div>
                <div className="p-2 bg-purple-100 rounded-lg">
                  <TrendingUp size={20} className="text-purple-600" />
                </div>
              </div>
            </div>

            {/* Pezzi Venduti */}
            <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Pezzi Venduti</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{todayData.pezzi_venduti}</p>
                  <p className="text-xs text-gray-500 mt-1">+{todayData.ricavo_vs_anno_precedente}% YoY</p>
                </div>
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Package size={20} className="text-orange-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Obiettivo Giornaliero */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-gray-900 font-semibold">Obiettivo Giornaliero</h3>
                <p className="text-sm text-gray-600 mt-1">
                  €{todayData.incasso.toFixed(2)} / €{todayData.obiettivo_giornaliero.toFixed(2)}
                </p>
              </div>
              <span
                className={`text-lg font-bold ${
                  percentRaggiungimento >= 100 ? 'text-green-600' : 'text-orange-600'
                }`}
              >
                {percentRaggiungimento.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  percentRaggiungimento >= 100 ? 'bg-green-500' : 'bg-orange-500'
                }`}
                style={{ width: `${Math.min(percentRaggiungimento, 100)}%` }}
              />
            </div>
          </div>

          {/* Weekly Progress */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-gray-900 font-semibold">Ricavo Settimana</h3>
                <p className="text-sm text-gray-600 mt-1">
                  €{weeklyData.ricavo_settimana.toFixed(2)} / €{weeklyData.obiettivo_settimanale.toFixed(2)}
                </p>
              </div>
              <span className="text-lg font-bold text-blue-600">{percentSettimanale.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(percentSettimanale, 100)}%` }}
              />
            </div>
          </div>

          {/* Hourly Sales Chart */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-gray-900 font-semibold mb-6">Vendite per Ora (Oggi)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={orariData}>
                <defs>
                  <linearGradient id="grad-active-sales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={1} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="grad-inactive-sales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#cbd5e1" stopOpacity={1} />
                    <stop offset="100%" stopColor="#cbd5e1" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="ora" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `€${value.toFixed(2)}`} suffix="" />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="vendite" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {orariData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.vendite > 0 ? 'url(#grad-active-sales)' : 'url(#grad-inactive-sales)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top 5 Products */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-gray-900 font-semibold mb-4">Top 5 Prodotti Oggi</h3>
            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div key={product.id} className="flex items-center justify-between pb-3 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-500 w-6">#{index + 1}</span>
                    <div>
                      <p className="text-gray-900 font-medium text-sm">{product.nome}</p>
                      <p className="text-xs text-gray-500">{product.quantita} pz</p>
                    </div>
                  </div>
                  <span className="font-semibold text-gray-900">€{product.importo.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Comparative Table */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-gray-900 font-semibold mb-4">Comparativo Ricavi</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-gray-600 text-sm font-medium">Oggi</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  €{comparativeData.oggi.toFixed(2)}
                </p>
              </div>
              <div className="p-4 bg-gray-100 rounded-lg border border-gray-300">
                <p className="text-gray-600 text-sm font-medium">Ieri</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  €{comparativeData.ieri.toFixed(2)}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  +{((comparativeData.oggi - comparativeData.ieri) / comparativeData.ieri * 100).toFixed(1)}%
                </p>
              </div>
              <div className="p-4 bg-gray-100 rounded-lg border border-gray-300">
                <p className="text-gray-600 text-sm font-medium">Media 7 gg</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  €{comparativeData.media_7gg.toFixed(2)}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  +{((comparativeData.oggi - comparativeData.media_7gg) / comparativeData.media_7gg * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Staff, Checklist, Weather, Actions */}
        <div className="col-span-4 space-y-6">
          {/* Monthly Progress - Circular */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-gray-900 font-semibold mb-6">Ricavo Mese</h3>
            <div className="flex flex-col items-center">
              <div className="relative w-32 h-32 mb-4">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="8"
                    strokeDasharray={`${(percentMensile / 100) * 2 * Math.PI * 54} ${2 * Math.PI * 54}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{percentMensile.toFixed(0)}%</p>
                    <p className="text-xs text-gray-500">del budget</p>
                  </div>
                </div>
              </div>
              <p className="text-gray-600 text-sm text-center">
                €{monthlyData.ricavo_mese.toFixed(0)} / €{monthlyData.budget_mensile.toFixed(0)}
              </p>
            </div>
          </div>

          {/* Staff on Duty */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-gray-600" />
              <h3 className="text-gray-900 font-semibold">Personale in Servizio</h3>
            </div>
            <div className="space-y-3">
              {staffData.map((staff) => (
                <div key={staff.id} className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded transition">
                  <div className="flex-1">
                    <p className="text-gray-900 font-medium text-sm">{staff.nome}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock size={12} className="text-gray-400" />
                      <span className="text-xs text-gray-500">
                        {staff.turno === 'mattina' ? '06:00-13:00' :
                          staff.turno === 'pomeriggio' ? '14:00-20:00' : '06:00-20:00'}
                        {' • '}{staff.ore}h
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">€{staff.vendite}</p>
                    <p className="text-xs text-gray-500">{staff.turno}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weather */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-700 text-sm font-medium">Meteo {currentOutlet.city}</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{weatherData.temp}°</p>
                <p className="text-sm text-gray-700 mt-1">{weatherData.condition}</p>
              </div>
              <Cloud size={48} className="text-blue-500 opacity-75" />
            </div>
          </div>

          {/* Checklist */}
          <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={18} className="text-gray-600" />
              <h3 className="text-gray-900 font-semibold">To-Do Operativi</h3>
            </div>
            <div className="space-y-2">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleChecklist(item.id)}
                  className="flex items-center gap-3 w-full p-2 rounded hover:bg-gray-50 transition text-left group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {item.completed ? (
                      <CheckCircle2 size={18} className="text-green-500" />
                    ) : (
                      <Circle size={18} className="text-gray-300 group-hover:text-gray-400" />
                    )}
                  </div>
                  <span
                    className={`text-sm flex-1 ${
                      item.completed
                        ? 'text-gray-500 line-through'
                        : 'text-gray-700 font-medium'
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl p-6 space-y-3 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-gray-900 font-semibold mb-3 text-sm">Azioni Veloci</h3>

            <button className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-medium py-3 rounded-lg transition">
              <AlertOctagon size={16} />
              Segnala Problema
            </button>

            <button className="w-full flex items-center justify-center gap-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 font-medium py-3 rounded-lg transition">
              <ShoppingCart size={16} />
              Richiedi Merce
            </button>

            <button className="w-full flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-medium py-3 rounded-lg transition">
              <FileText size={16} />
              Note Giornaliere
            </button>
          </div>

          {/* Alert Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-900 text-sm">Attenzione</p>
                <p className="text-xs text-amber-800 mt-1">
                  Mancano 1h 46m alla chiusura. Preparare chiusura cassa.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreManager;
