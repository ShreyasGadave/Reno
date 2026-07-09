import { Button } from "@/components/ui/button";
import Link from "next/link";

const Page = () => {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex gap-4">
        <Link href="/signin">
          <Button variant="link">Signin</Button>
        </Link>

        <Link href="/signup">
          <Button>Signup</Button>
        </Link>
      </div>
    </div>
  );
};

export default Page;