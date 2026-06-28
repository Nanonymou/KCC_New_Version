import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./AuthContext";
import ProtectedRoute  from "./ProtectedRoute";
import LoginPage       from "./LoginPage";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <ProtectedRoute fallback={<LoginPage />}>
        <App />
      </ProtectedRoute>
    </AuthProvider>
  </StrictMode>
);
