import { useTranslation } from "@/features/localization/react";
import { Link } from "expo-router";
import { Heading, Page, palette } from "@/components/elements";

export default function NotFound() {
  const t = useTranslation();
  return (
    <Page>
      <Heading title={t("notFound.title")} subtitle={t("notFound.description")} />
      <Link href="/" style={{ color: palette.blue }}>
        {t("notFound.backHome")}
      </Link>
    </Page>
  );
}
