import { useLocation, useNavigate } from "react-router-dom";

interface Item {
  label: string;
  path: string;
}

export const ACCOUNT_NAV: Item[] = [
  { label: "Your Account",     path: "/account" },
  { label: "Login & Security", path: "/account/security" },
  { label: "Your Addresses",   path: "/account/addresses" },
];

export const ORDERS_NAV: Item[] = [
  { label: "Your Orders",       path: "/orders" },
  { label: "Track Order",       path: "/track-order" },
  { label: "Returns & Refunds", path: "/returns" },
];

const PageSubNav = ({ items }: { items: Item[] }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {items.map(item => {
        const active = pathname === item.path;
        return (
          <button key={item.path} onClick={() => navigate(item.path)}
            className="font-sans text-sm px-4 py-2 rounded-full transition-all"
            style={{
              background: active ? "#0F1111" : "#fff",
              color:      active ? "#fff"    : "#0F1111",
              border:     "1px solid #DDD",
              fontWeight: active ? 600 : 400,
            }}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default PageSubNav;
