import { Button } from "@/components/ui/button";
import Link from "next/link";

const page = () => {
  return (
    <div>
      <Link href={"/signin"}>
        <Button variant={"link"}>Signin</Button>
      </Link>
      <Link href={"/signup"}>
        <Button>Signup</Button>
      </Link>
    </div>
  );
};

export default page;
