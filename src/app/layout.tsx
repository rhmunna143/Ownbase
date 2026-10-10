import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Native Windows Server Hub",
  description: "Native Windows server orchestration platform without Docker or WSL2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#080c14] text-slate-100 antialiased selection:bg-blue-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
