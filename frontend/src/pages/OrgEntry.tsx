import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/api";
import AvatarSetup from "./AvatarSetup";
import SpaceSelect from "./SpaceSelect";

type Step = "checking" | "avatar" | "spaces";

export default function OrgEntry() {
  const { user } = useAuth();
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("checking");

  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (!orgId) {
      navigate("/dashboard", { replace: true });
      return;
    }
    api
      .get(`/organizations/${orgId}/avatar/me`)
      .then(() => setStep("spaces"))
      .catch((err) => {
        if (err.response?.status === 404) {
          setStep("avatar");
        } else {
          navigate("/dashboard", { replace: true });
        }
      });
  }, [user, orgId, navigate]);

  if (!orgId) return null;
  if (step === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (step === "avatar") {
    return <AvatarSetup />;
  }
  return <SpaceSelect />;
}
