[System.IO.File]::WriteAllText("$PWD\app\layout.tsx", @'
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TruckOps AI",
  description: "AI Back-Office for Trucking Fleets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
'@, (New-Object System.Text.UTF8Encoding($false))
