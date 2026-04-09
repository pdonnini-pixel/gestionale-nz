#!/bin/bash
# Deploy Gestionale NZ su Netlify
# Uso: ./deploy.sh

set -e

echo "🔨 Building..."
npx vite build

echo "🚀 Deploying to Netlify..."
NETLIFY_AUTH_TOKEN="nfp_qAfXm8D12J3z2BqnTWTW5rmfYH3Hznm7a24d" \
  npx netlify deploy --prod --dir=dist --site=0698e8bc-b846-4f11-89d5-ad70d3afd66d

echo "✅ Deploy completato! → https://gestionale-nz.netlify.app"
