import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuditMovedBanner } from "@/components/AuditMovedBanner";

/** Redirects old /clients/:clientId/audit/* routes to /audit/* */
export default function AuditRedirect() {
  const { clientId, "*": rest } = useParams();
  const navigate = useNavigate();

  const target = rest ? `/audit/${clientId}/${rest}` : `/audit`;

  useEffect(() => {
    // Show banner briefly then redirect
    const timer = setTimeout(() => {
      navigate(target, { replace: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [target, navigate]);

  return <AuditMovedBanner redirectTo={target} />;
}
