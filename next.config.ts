import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  // Suppress Turbopack/webpack config conflict from PWA plugin
  turbopack: {},

  // Include the Xero reference CSV files in Vercel's output bundle so that
  // lib/invoiceReferenceData.ts can read them via fs.readFileSync at runtime.
  // Without this, the /data/ directory is not copied into the serverless function.
  outputFileTracingIncludes: {
    '/api/ai-extract-invoice': ['./data/**'],
  },
};

export default withPWA(nextConfig);
