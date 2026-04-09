import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Download,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Check,
} from 'lucide-react';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';

const MarginiCategoria = () => {
  const [selectedOutlet, setSelectedOutlet] = useState('tutti');
  const [sortConfig, setSortConfig] = useState({
    key: 'marginePercentuale',
    direction: 'desc',
  });

  // Outlet definitions
  const outlets = [
    { id: 'tutti', label: 'Tutti gli outlet' },
    { id: 'valdichiana', label: 'Valdichiana' },
    { id: 'barberino', label: 'Barberino' },
    { id: 'palmanova', label: 'Palmanova' },
    { id: 'franciacorta', label: 'Franciacorta' },
    { id: 'brugnato', label: 'Brugnato' },
    { id: 'valmontone', label: 'Valmontone' },
    { id: 'torino', label: 'Torino' },
  ];

  // Hardcoded data per category and outlet
  const categoryData = {
    'T-shirt': {
      valdichiana: {
        ricavo: 145000,
        costoAcquisto: 72500,
        pezziVenduti: 2900,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      barberino: {
        ricavo: 138000,
        costoAcquisto: 69000,
        pezziVenduti: 2760,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      palmanova: {
        ricavo: 155000,
        costoAcquisto: 77500,
        pezziVenduti: 3100,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      franciacorta: {
        ricavo: 125000,
        costoAcquisto: 62500,
        pezziVenduti: 2500,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      brugnato: {
        ricavo: 95000,
        costoAcquisto: 47500,
        pezziVenduti: 1900,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      valmontone: {
        ricavo: 110000,
        costoAcquisto: 55000,
        pezziVenduti: 2200,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
      torino: {
        ricavo: 165000,
        costoAcquisto: 82500,
        pezziVenduti: 3300,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 25,
      },
    },
    Felpe: {
      valdichiana: {
        ricavo: 185000,
        costoAcquisto: 83250,
        pezziVenduti: 1850,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      barberino: {
        ricavo: 172000,
        costoAcquisto: 77400,
        pezziVenduti: 1720,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      palmanova: {
        ricavo: 198000,
        costoAcquisto: 89100,
        pezziVenduti: 1980,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      franciacorta: {
        ricavo: 165000,
        costoAcquisto: 74250,
        pezziVenduti: 1650,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      brugnato: {
        ricavo: 125000,
        costoAcquisto: 56250,
        pezziVenduti: 1250,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      valmontone: {
        ricavo: 145000,
        costoAcquisto: 65250,
        pezziVenduti: 1450,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
      torino: {
        ricavo: 210000,
        costoAcquisto: 94500,
        pezziVenduti: 2100,
        prezzoMedioVendita: 100,
        prezzoMedioAcquisto: 45,
      },
    },
    Pantaloni: {
      valdichiana: {
        ricavo: 216000,
        costoAcquisto: 86400,
        pezziVenduti: 1800,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      barberino: {
        ricavo: 204000,
        costoAcquisto: 81600,
        pezziVenduti: 1700,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      palmanova: {
        ricavo: 234000,
        costoAcquisto: 93600,
        pezziVenduti: 1950,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      franciacorta: {
        ricavo: 198000,
        costoAcquisto: 79200,
        pezziVenduti: 1650,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      brugnato: {
        ricavo: 150000,
        costoAcquisto: 60000,
        pezziVenduti: 1250,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      valmontone: {
        ricavo: 174000,
        costoAcquisto: 69600,
        pezziVenduti: 1450,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
      torino: {
        ricavo: 252000,
        costoAcquisto: 100800,
        pezziVenduti: 2100,
        prezzoMedioVendita: 120,
        prezzoMedioAcquisto: 48,
      },
    },
    Giacche: {
      valdichiana: {
        ricavo: 280000,
        costoAcquisto: 98000,
        pezziVenduti: 700,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      barberino: {
        ricavo: 260000,
        costoAcquisto: 91000,
        pezziVenduti: 650,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      palmanova: {
        ricavo: 300000,
        costoAcquisto: 105000,
        pezziVenduti: 750,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      franciacorta: {
        ricavo: 320000,
        costoAcquisto: 112000,
        pezziVenduti: 800,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      brugnato: {
        ricavo: 200000,
        costoAcquisto: 70000,
        pezziVenduti: 500,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      valmontone: {
        ricavo: 240000,
        costoAcquisto: 84000,
        pezziVenduti: 600,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
      torino: {
        ricavo: 360000,
        costoAcquisto: 126000,
        pezziVenduti: 900,
        prezzoMedioVendita: 400,
        prezzoMedioAcquisto: 140,
      },
    },
    Accessori: {
      valdichiana: {
        ricavo: 125000,
        costoAcquisto: 37500,
        pezziVenduti: 2500,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      barberino: {
        ricavo: 118000,
        costoAcquisto: 35400,
        pezziVenduti: 2360,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      palmanova: {
        ricavo: 135000,
        costoAcquisto: 40500,
        pezziVenduti: 2700,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      franciacorta: {
        ricavo: 110000,
        costoAcquisto: 33000,
        pezziVenduti: 2200,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      brugnato: {
        ricavo: 85000,
        costoAcquisto: 25500,
        pezziVenduti: 1700,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      valmontone: {
        ricavo: 100000,
        costoAcquisto: 30000,
        pezziVenduti: 2000,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      torino: {
        ricavo: 145000,
        costoAcquisto: 43500,
        pezziVenduti: 2900,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
    },
    Calzature: {
      valdichiana: {
        ricavo: 195000,
        costoAcquisto: 78000,
        pezziVenduti: 1300,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      barberino: {
        ricavo: 182000,
        costoAcquisto: 72800,
        pezziVenduti: 1213,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      palmanova: {
        ricavo: 210000,
        costoAcquisto: 84000,
        pezziVenduti: 1400,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      franciacorta: {
        ricavo: 225000,
        costoAcquisto: 90000,
        pezziVenduti: 1500,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      brugnato: {
        ricavo: 155000,
        costoAcquisto: 62000,
        pezziVenduti: 1033,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      valmontone: {
        ricavo: 180000,
        costoAcquisto: 72000,
        pezziVenduti: 1200,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
      torino: {
        ricavo: 240000,
        costoAcquisto: 96000,
        pezziVenduti: 1600,
        prezzoMedioVendita: 150,
        prezzoMedioAcquisto: 60,
      },
    },
    Borse: {
      valdichiana: {
        ricavo: 185000,
        costoAcquisto: 55500,
        pezziVenduti: 925,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      barberino: {
        ricavo: 172000,
        costoAcquisto: 51600,
        pezziVenduti: 860,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      palmanova: {
        ricavo: 198000,
        costoAcquisto: 59400,
        pezziVenduti: 990,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      franciacorta: {
        ricavo: 220000,
        costoAcquisto: 66000,
        pezziVenduti: 1100,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      brugnato: {
        ricavo: 150000,
        costoAcquisto: 45000,
        pezziVenduti: 750,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      valmontone: {
        ricavo: 175000,
        costoAcquisto: 52500,
        pezziVenduti: 875,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
      torino: {
        ricavo: 245000,
        costoAcquisto: 73500,
        pezziVenduti: 1225,
        prezzoMedioVendita: 200,
        prezzoMedioAcquisto: 60,
      },
    },
    Intimo: {
      valdichiana: {
        ricavo: 95000,
        costoAcquisto: 28500,
        pezziVenduti: 1900,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      barberino: {
        ricavo: 88000,
        costoAcquisto: 26400,
        pezziVenduti: 1760,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      palmanova: {
        ricavo: 105000,
        costoAcquisto: 31500,
        pezziVenduti: 2100,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      franciacorta: {
        ricavo: 92000,
        costoAcquisto: 27600,
        pezziVenduti: 1840,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      brugnato: {
        ricavo: 68000,
        costoAcquisto: 20400,
        pezziVenduti: 1360,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      valmontone: {
        ricavo: 82000,
        costoAcquisto: 24600,
        pezziVenduti: 1640,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
      torino: {
        ricavo: 115000,
        costoAcquisto: 34500,
        pezziVenduti: 2300,
        prezzoMedioVendita: 50,
        prezzoMedioAcquisto: 15,
      },
    },
  };

  // Calculate aggregated data based on selected outlet
  const calculateCategoryStats = useMemo(() => {
    const stats = {};

    Object.entries(categoryData).forEach(([categoria, outletData]) => {
      let totalRicavo = 0;
      let totalCosto = 0;
      let totalPezzi = 0;

      if (selectedOutlet === 'tutti') {
        Object.values(outletData).forEach((data) => {
          totalRicavo += data.ricavo;
          totalCosto += data.costoAcquisto;
          totalPezzi += data.pezziVenduti;
        });
      } else {
        const data = outletData[selectedOutlet];
        if (data) {
          totalRicavo = data.ricavo;
          totalCosto = data.costoAcquisto;
          totalPezzi = data.pezziVenduti;
        }
      }

      const margineLoardo = totalRicavo - totalCosto;
      const marginePercentuale =
        totalRicavo > 0 ? ((margineLoardo / totalRicavo) * 100).toFixed(2) : 0;
      const ricarico =
        totalCosto > 0
          ? (((totalRicavo - totalCosto) / totalCosto) * 100).toFixed(2)
          : 0;
      const prezzoMedioVendita =
        totalPezzi > 0 ? (totalRicavo / totalPezzi).toFixed(2) : 0;
      const prezzoMedioAcquisto =
        totalPezzi > 0 ? (totalCosto / totalPezzi).toFixed(2) : 0;

      stats[categoria] = {
        categoria,
        ricavo: totalRicavo,
        costoAcquisto: totalCosto,
        margineLoardo,
        marginePercentuale: parseFloat(marginePercentuale),
        ricarico: parseFloat(ricarico),
        pezziVenduti: totalPezzi,
        prezzoMedioVendita: parseFloat(prezzoMedioVendita),
        prezzoMedioAcquisto: parseFloat(prezzoMedioAcquisto),
      };
    });

    return stats;
  }, [selectedOutlet]);

  // Prepare chart data
  const chartDataMargine = useMemo(() => {
    return Object.values(calculateCategoryStats)
      .sort((a, b) => b.marginePercentuale - a.marginePercentuale)
      .map((item) => ({
        name: item.categoria,
        'Margine %': parseFloat(item.marginePercentuale),
      }));
  }, [calculateCategoryStats]);

  const chartDataRicavi = useMemo(() => {
    return Object.values(calculateCategoryStats).map((item) => ({
      name: item.categoria,
      value: item.ricavo,
    }));
  }, [calculateCategoryStats]);

  const chartDataCostoMargine = useMemo(() => {
    return Object.values(calculateCategoryStats).map((item) => ({
      name: item.categoria,
      Costo: item.costoAcquisto,
      Margine: item.margineLoardo,
    }));
  }, [calculateCategoryStats]);

  // Trend data (simulated month-over-month)
  const trendData = useMemo(() => {
    const months = [
      'Set 2025',
      'Ott 2025',
      'Nov 2025',
      'Dic 2025',
      'Gen 2026',
      'Feb 2026',
    ];
    const categories = Object.keys(categoryData);

    return months.map((month, idx) => {
      const dataPoint = { month };
      categories.forEach((cat) => {
        const baseMargin =
          calculateCategoryStats[cat].marginePercentuale || 0;
        const variation = (Math.random() - 0.5) * 8;
        dataPoint[cat] = Math.max(
          20,
          Math.min(70, baseMargin + variation)
        ).toFixed(1);
      });
      return dataPoint;
    });
  }, [calculateCategoryStats]);

  // Sort table data
  const sortedData = useMemo(() => {
    let sorted = [...Object.values(calculateCategoryStats)];

    sorted.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }, [calculateCategoryStats, sortConfig]);

  // Color coding function
  const getMargineColor = (percentage) => {
    if (percentage >= 55) return 'bg-green-50 border-l-4 border-green-500';
    if (percentage >= 45) return 'bg-yellow-50 border-l-4 border-yellow-500';
    return 'bg-red-50 border-l-4 border-red-500';
  };

  const getMargineTextColor = (percentage) => {
    if (percentage >= 55) return 'text-green-700 font-semibold';
    if (percentage >= 45) return 'text-yellow-700 font-semibold';
    return 'text-red-700 font-semibold';
  };

  // Find best and worst
  const bestCategory = sortedData[0];
  const worstCategory = sortedData[sortedData.length - 1];

  // Colors for pie chart
  const COLORS = [
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#3b82f6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
  ];

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-full mx-auto space-y-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-600">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Analisi Margini per Categoria
              </h1>
              <p className="text-gray-600 mt-2">
                Dettagli performance di margine lordo, ricarico e vendite per
                categoria prodotto
              </p>
            </div>
            <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
              <Download size={20} />
              Esporta
            </button>
          </div>
        </div>

        {/* Outlet Filter */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Filtro Outlet
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {outlets.map((outlet) => (
              <button
                key={outlet.id}
                onClick={() => setSelectedOutlet(outlet.id)}
                className={`p-3 rounded-lg font-medium transition ${
                  selectedOutlet === outlet.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {outlet.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border-t-4 border-blue-500">
            <div className="text-gray-600 text-sm font-semibold mb-1">
              Ricavo Totale
            </div>
            <div className="text-2xl font-bold text-gray-900">
              €
              {Object.values(calculateCategoryStats)
                .reduce((sum, cat) => sum + cat.ricavo, 0)
                .toLocaleString('it-IT')}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-t-4 border-green-500">
            <div className="text-gray-600 text-sm font-semibold mb-1">
              Margine Lordo Totale
            </div>
            <div className="text-2xl font-bold text-green-700">
              €
              {Object.values(calculateCategoryStats)
                .reduce((sum, cat) => sum + cat.margineLoardo, 0)
                .toLocaleString('it-IT')}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-t-4 border-purple-500">
            <div className="text-gray-600 text-sm font-semibold mb-1">
              Margine % Medio
            </div>
            <div className="text-2xl font-bold text-purple-700">
              {(
                Object.values(calculateCategoryStats).reduce(
                  (sum, cat) => sum + cat.marginePercentuale,
                  0
                ) / Object.keys(calculateCategoryStats).length
              ).toFixed(1)}
              %
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border-t-4 border-orange-500">
            <div className="text-gray-600 text-sm font-semibold mb-1">
              Pezzi Venduti
            </div>
            <div className="text-2xl font-bold text-orange-700">
              {Object.values(calculateCategoryStats)
                .reduce((sum, cat) => sum + cat.pezziVenduti, 0)
                .toLocaleString('it-IT')}
            </div>
          </div>
        </div>

        {/* Best/Worst Categories */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {bestCategory && (
            <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-600">
              <div className="flex items-start gap-4">
                <div className="bg-green-100 p-3 rounded-lg">
                  <TrendingUp className="text-green-600" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-600 mb-1">
                    Categoria Migliore
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {bestCategory.categoria}
                  </p>
                  <p className="text-green-700 font-semibold mt-1">
                    {bestCategory.marginePercentuale}% di margine
                  </p>
                </div>
              </div>
            </div>
          )}

          {worstCategory && (
            <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-red-600">
              <div className="flex items-start gap-4">
                <div className="bg-red-100 p-3 rounded-lg">
                  <TrendingDown className="text-red-600" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-600 mb-1">
                    Categoria Peggiore
                  </h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {worstCategory.categoria}
                  </p>
                  <p className="text-red-700 font-semibold mt-1">
                    {worstCategory.marginePercentuale}% di margine
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Horizontal Bar Chart - Margine % */}
          <div className="rounded-lg shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Margine % per Categoria
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartDataMargine}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 120, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="grad-margine-cat" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis type="number" {...AXIS_STYLE} />
                <YAxis dataKey="name" type="category" width={110} {...AXIS_STYLE} />
                <Tooltip content={<GlassTooltip formatter={(value) => `${value.toFixed(1)}%`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="Margine %" fill="url(#grad-margine-cat)" radius={[0, 8, 8, 0]} animationDuration={800} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart - Composizione Ricavi */}
          <div className="rounded-lg shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Composizione Ricavi per Categoria
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <defs>
                  <linearGradient id="pie-margini-1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-4" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-5" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-6" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ec4899" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ec4899" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-7" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="pie-margini-8" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <Pie
                  data={chartDataRicavi}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {chartDataRicavi.map((entry, index) => {
                    const gradId = `pie-margini-${index + 1}`;
                    return <Cell key={`cell-${index}`} fill={`url(#${gradId})`} stroke="white" strokeWidth={2} />;
                  })}
                </Pie>
                <Tooltip content={<GlassTooltip formatter={(value) => `€${value.toLocaleString()}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Stacked Bar Chart - Costo vs Margine */}
        <div className="rounded-lg shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Composizione Ricavi: Costo vs Margine
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartDataCostoMargine}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="grad-costo-margine-cost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={1} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                </linearGradient>
                <linearGradient id="grad-costo-margine-marg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="name" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} />
              <Tooltip content={<GlassTooltip formatter={(value) => `€${value.toLocaleString()}`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Legend />
              <Bar dataKey="Costo" stackId="a" fill="url(#grad-costo-margine-cost)" radius={[8, 8, 0, 0]} animationDuration={800} />
              <Bar dataKey="Margine" stackId="a" fill="url(#grad-costo-margine-marg)" radius={[8, 8, 0, 0]} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Trend Chart - 6 Months */}
        <div className="rounded-lg shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Trend Margine % - Ultimi 6 Mesi
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart
              data={trendData}
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="month" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} />
              <Tooltip content={<GlassTooltip formatter={(value) => `${value}%`} />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
              <Legend />
              {Object.keys(categoryData).map((categoria, idx) => (
                <Line
                  key={categoria}
                  type="monotone"
                  dataKey={categoria}
                  stroke={COLORS[idx % COLORS.length]}
                  dot={{ r: 4 }}
                  strokeWidth={2.5}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Dettagli Categorie
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Clicca sulle colonne per ordinare. I margini sono colorati in base
              alla performance.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {[
                    { key: 'categoria', label: 'Categoria' },
                    { key: 'pezziVenduti', label: 'Pezzi' },
                    { key: 'ricavo', label: 'Ricavo' },
                    { key: 'costoAcquisto', label: 'Costo' },
                    { key: 'margineLoardo', label: 'Margine €' },
                    { key: 'marginePercentuale', label: 'Margine %' },
                    { key: 'ricarico', label: 'Ricarico %' },
                    { key: 'prezzoMedioVendita', label: 'Prezzo Medio V.' },
                    { key: 'prezzoMedioAcquisto', label: 'Prezzo Medio A.' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition"
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span className="ml-2">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedData.map((category) => (
                  <tr
                    key={category.categoria}
                    className={getMargineColor(category.marginePercentuale)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">
                      {category.categoria}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      {category.pezziVenduti.toLocaleString('it-IT')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      €{category.ricavo.toLocaleString('it-IT')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      €{category.costoAcquisto.toLocaleString('it-IT')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-green-700">
                      €{category.margineLoardo.toLocaleString('it-IT')}
                    </td>
                    <td
                      className={`px-6 py-4 whitespace-nowrap ${getMargineTextColor(
                        category.marginePercentuale
                      )}`}
                    >
                      {category.marginePercentuale}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      {category.ricarico}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      €{category.prezzoMedioVendita.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      €{category.prezzoMedioAcquisto.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Note */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-blue-600 flex-shrink-0" size={20} />
          <div className="text-sm text-blue-800">
            <strong>Nota:</strong> I dati sono aggregati da tutti gli outlet
            selezionati. I margini sono codificati per colore: verde ({'>='} 55%),
            giallo (45-55%), rosso ({'<'} 45%). I dati di trend sono simulati per
            illustrare l'analisi mensile.
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarginiCategoria;
